import socket
import stat
import errno
from io import BytesIO
from unittest.mock import MagicMock, call, patch

import paramiko
import pytest

from app.errors import ApiError
from app.sftp import SftpService


@patch("app.sftp.paramiko.SSHClient")
def test_validate_opens_and_closes_short_lived_sftp(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    sftp.normalize.return_value = "/home/deploy"

    result = SftpService().validate(host="server", port=22, username="deploy", password="secret")

    assert result.initial_path == "/home/deploy"
    client.connect.assert_called_once_with(
        hostname="server",
        port=22,
        username="deploy",
        password="secret",
        timeout=10.0,
        banner_timeout=10.0,
        auth_timeout=10.0,
        channel_timeout=30.0,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@pytest.mark.parametrize(
    ("failure", "status_code", "code"),
    [
        (paramiko.AuthenticationException("denied"), 401, "authentication_failed"),
        (socket.timeout("late"), 504, "sftp_timeout"),
        (paramiko.SSHException("broken"), 502, "sftp_unavailable"),
        (OSError("refused"), 502, "sftp_unavailable"),
    ],
)
@patch("app.sftp.paramiko.SSHClient")
def test_validate_maps_failures_and_always_closes_client(
    ssh_client_class: MagicMock,
    failure: Exception,
    status_code: int,
    code: str,
) -> None:
    client = ssh_client_class.return_value
    client.connect.side_effect = failure

    with pytest.raises(ApiError) as captured:
        SftpService().validate(host="server", port=22, username="deploy", password="secret")

    assert captured.value.status_code == status_code
    assert captured.value.code == code
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_validate_closes_sftp_when_normalize_fails(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    sftp.normalize.side_effect = paramiko.SSHException("failed")

    with pytest.raises(ApiError):
        SftpService().validate(host="server", port=22, username="deploy", password="secret")

    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_list_directory_returns_sorted_metadata_and_closes_connection(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    sftp.normalize.return_value = "/home/deploy"
    folder = paramiko.SFTPAttributes()
    folder.filename = "Documents"
    folder.st_mode = stat.S_IFDIR | 0o755
    folder.st_size = 4096
    folder.st_mtime = 1_700_000_000
    file = paramiko.SFTPAttributes()
    file.filename = "photo.jpg"
    file.st_mode = stat.S_IFREG | 0o644
    file.st_size = 2048
    file.st_mtime = 1_700_000_100
    sftp.listdir_attr.return_value = [file, folder]

    listing = SftpService().list_directory(
        host="server",
        port=22,
        username="deploy",
        password="secret",
        path=".",
    )

    assert listing.path == "/home/deploy"
    assert [item.name for item in listing.items] == ["Documents", "photo.jpg"]
    assert listing.items[0].kind == "folder"
    assert listing.items[0].size is None
    assert listing.items[1].kind == "image"
    assert listing.items[1].permissions == "-rw-r--r--"
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_file_transfer_and_mutation_operations_delegate_to_sftp(ssh_client_class: MagicMock) -> None:
    sftp = ssh_client_class.return_value.open_sftp.return_value
    remote_file = sftp.open.return_value
    uploaded = paramiko.SFTPAttributes()
    uploaded.st_size = 6
    sftp.stat.return_value = uploaded
    service = SftpService()
    credentials = {"host": "server", "port": 22, "username": "deploy", "password": "secret"}

    source = BytesIO(b"upload")
    service.upload_file(**credentials, source=source, path="/remote/file.txt", size=6)
    service.create_directory(**credentials, path="/remote/new")
    assert service.rename_entry(**credentials, path="/remote/file.txt", name="renamed.txt") == "/remote/renamed.txt"
    assert service.move_entry(**credentials, path="/remote/renamed.txt", destination="/archive") == "/archive/renamed.txt"
    service.change_permissions(**credentials, path="/archive/renamed.txt", mode="0640")

    temporary_path = sftp.open.call_args.args[0]
    assert temporary_path.startswith("/remote/.file.txt.upload-")
    sftp.open.assert_called_once_with(temporary_path, "wbx", bufsize=0)
    remote_file.write.assert_called_once_with(b"upload")
    sftp.posix_rename.assert_called_once_with(temporary_path, "/remote/file.txt")
    sftp.mkdir.assert_called_once_with("/remote/new")
    assert sftp.rename.call_args_list[0].args == ("/remote/file.txt", "/remote/renamed.txt")
    assert sftp.rename.call_args_list[1].args == ("/remote/renamed.txt", "/archive/renamed.txt")
    sftp.chmod.assert_called_once_with("/archive/renamed.txt", 0o640)


@patch("app.sftp.paramiko.SSHClient")
def test_open_download_reads_bounded_chunks_and_closes_every_resource(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    remote_file = sftp.open.return_value
    attributes = paramiko.SFTPAttributes()
    attributes.st_mode = stat.S_IFREG | 0o644
    attributes.st_size = 7
    sftp.stat.return_value = attributes
    remote_file.read.side_effect = [b"abcd", b"efg", b""]

    session = SftpService().open_download(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )

    assert session.size == 7
    assert session.read(4) == b"abcd"
    assert session.read(4) == b"efg"
    assert session.read(4) == b""
    session.close()
    session.close()

    assert remote_file.read.call_args_list == [call(4), call(4), call(4)]
    sftp.open.assert_called_once_with("/remote/file.bin", "rb", bufsize=0)
    remote_file.close.assert_called_once()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_download_read_maps_failure_without_hiding_required_cleanup(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    remote_file = sftp.open.return_value
    attributes = paramiko.SFTPAttributes()
    attributes.st_mode = stat.S_IFREG | 0o644
    attributes.st_size = 10
    sftp.stat.return_value = attributes
    remote_file.read.side_effect = socket.timeout("late")
    session = SftpService().open_download(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )

    with pytest.raises(ApiError) as captured:
        session.read(4096)
    session.close()

    assert captured.value.status_code == 504
    assert captured.value.code == "sftp_timeout"
    remote_file.close.assert_called_once()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_upload_stream_writes_chunks_then_atomically_publishes_and_closes(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    remote_file = sftp.open.return_value
    attributes = paramiko.SFTPAttributes()
    attributes.st_size = 6
    sftp.stat.return_value = attributes
    session = SftpService().open_upload(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )

    assert session.write(b"abc") == 3
    assert session.write(b"def") == 3
    assert session.finish(expected_size=6) == 6
    session.close()

    assert remote_file.write.call_args_list == [call(b"abc"), call(b"def")]
    remote_file.close.assert_called_once()
    sftp.stat.assert_called_once_with(session.temporary_path)
    sftp.posix_rename.assert_called_once_with(session.temporary_path, "/remote/file.bin")
    sftp.remove.assert_not_called()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_upload_abort_removes_partial_remote_file_and_closes_resources(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    remote_file = sftp.open.return_value
    session = SftpService().open_upload(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )
    temporary_path = session.temporary_path

    session.write(b"partial")
    session.abort()
    session.abort()

    sftp.remove.assert_called_once_with(temporary_path)
    remote_file.close.assert_called_once()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_upload_write_failure_aborts_partial_remote_file(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    remote_file = sftp.open.return_value
    remote_file.write.side_effect = OSError("connection lost")
    session = SftpService().open_upload(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )

    with pytest.raises(ApiError) as captured:
        session.write(b"partial")

    assert captured.value.status_code == 502
    assert captured.value.code == "sftp_unavailable"
    sftp.remove.assert_called_once_with(session.temporary_path)
    remote_file.close.assert_called_once()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_upload_size_mismatch_aborts_without_replacing_destination(ssh_client_class: MagicMock) -> None:
    client = ssh_client_class.return_value
    sftp = client.open_sftp.return_value
    session = SftpService().open_upload(
        host="server", port=22, username="deploy", password="secret", path="/remote/file.bin",
    )
    session.write(b"short")

    with pytest.raises(ApiError) as captured:
        session.finish(expected_size=10)

    assert captured.value.status_code == 400
    assert captured.value.code == "upload_size_mismatch"
    sftp.remove.assert_called_once_with(session.temporary_path)
    sftp.posix_rename.assert_not_called()
    sftp.close.assert_called_once()
    client.close.assert_called_once()


@patch("app.sftp.paramiko.SSHClient")
def test_delete_entry_selects_file_or_empty_directory_operation(ssh_client_class: MagicMock) -> None:
    sftp = ssh_client_class.return_value.open_sftp.return_value
    service = SftpService()
    credentials = {"host": "server", "port": 22, "username": "deploy", "password": "secret"}
    regular = paramiko.SFTPAttributes()
    regular.st_mode = stat.S_IFREG | 0o644
    folder = paramiko.SFTPAttributes()
    folder.st_mode = stat.S_IFDIR | 0o755
    sftp.lstat.side_effect = [regular, folder]
    sftp.listdir.return_value = []

    service.delete_entry(**credentials, path="/remote/file.txt")
    service.delete_entry(**credentials, path="/remote/empty")

    sftp.remove.assert_called_once_with("/remote/file.txt")
    sftp.listdir.assert_called_once_with("/remote/empty")
    sftp.rmdir.assert_called_once_with("/remote/empty")


@patch("app.sftp.paramiko.SSHClient")
def test_delete_entry_reports_non_empty_directory_before_rmdir(ssh_client_class: MagicMock) -> None:
    sftp = ssh_client_class.return_value.open_sftp.return_value
    folder = paramiko.SFTPAttributes()
    folder.st_mode = stat.S_IFDIR | 0o755
    sftp.lstat.return_value = folder
    sftp.listdir.return_value = ["photo.jpg"]

    with pytest.raises(ApiError) as captured:
        SftpService().delete_entry(
            host="server", port=22, username="deploy", password="secret", path="/remote/photos",
        )

    assert captured.value.status_code == 409
    assert captured.value.code == "directory_not_empty"
    assert captured.value.message == "O diretório precisa estar vazio para ser excluído."
    sftp.rmdir.assert_not_called()


@patch("app.sftp.paramiko.SSHClient")
def test_remote_mutation_errors_have_actionable_api_codes(ssh_client_class: MagicMock) -> None:
    sftp = ssh_client_class.return_value.open_sftp.return_value
    sftp.mkdir.side_effect = OSError(errno.EEXIST, "exists")

    with pytest.raises(ApiError) as captured:
        SftpService().create_directory(
            host="server", port=22, username="deploy", password="secret", path="/remote/existing",
        )

    assert captured.value.status_code == 409
    assert captured.value.code == "entry_exists"
