import socket
import stat
import errno
from io import BytesIO
from unittest.mock import MagicMock, patch

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
    service = SftpService()
    credentials = {"host": "server", "port": 22, "username": "deploy", "password": "secret"}

    source = BytesIO(b"upload")
    service.upload_file(**credentials, source=source, path="/remote/file.txt", size=6)
    service.create_directory(**credentials, path="/remote/new")
    assert service.rename_entry(**credentials, path="/remote/file.txt", name="renamed.txt") == "/remote/renamed.txt"
    assert service.move_entry(**credentials, path="/remote/renamed.txt", destination="/archive") == "/archive/renamed.txt"
    service.change_permissions(**credentials, path="/archive/renamed.txt", mode="0640")

    sftp.putfo.assert_called_once_with(source, "/remote/file.txt", file_size=6, confirm=True)
    sftp.mkdir.assert_called_once_with("/remote/new")
    assert sftp.rename.call_args_list[0].args == ("/remote/file.txt", "/remote/renamed.txt")
    assert sftp.rename.call_args_list[1].args == ("/remote/renamed.txt", "/archive/renamed.txt")
    sftp.chmod.assert_called_once_with("/archive/renamed.txt", 0o640)


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
