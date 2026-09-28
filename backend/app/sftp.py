import errno
import logging
import shutil
import socket
import stat
import uuid
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import BinaryIO, Iterator, NoReturn

import paramiko

from .errors import ApiError
from .models import DirectoryListing, FileKind, RemoteFile


logger = logging.getLogger("sftp_explorer.transfer")


@dataclass(frozen=True, slots=True)
class SftpValidationResult:
    initial_path: str


def _raise_api_error(exc: BaseException) -> NoReturn:
    if isinstance(exc, ApiError):
        raise exc
    if isinstance(exc, paramiko.AuthenticationException):
        raise ApiError(401, "authentication_failed", "Usuário ou senha SFTP inválidos.") from exc
    if isinstance(exc, (socket.timeout, TimeoutError)):
        raise ApiError(504, "sftp_timeout", "O servidor SFTP não respondeu dentro do tempo limite.") from exc
    if isinstance(exc, PermissionError):
        raise ApiError(403, "permission_denied", "A conta não possui permissão para acessar este caminho.") from exc
    if isinstance(exc, FileNotFoundError):
        raise ApiError(404, "remote_path_not_found", "O caminho remoto não foi encontrado.") from exc
    if isinstance(exc, OSError):
        remote_errors = {
            errno.EEXIST: (409, "entry_exists", "Já existe um item com esse nome."),
            errno.ENOTEMPTY: (409, "directory_not_empty", "O diretório precisa estar vazio para ser excluído."),
            errno.EISDIR: (400, "invalid_entry_operation", "A operação não é válida para um diretório."),
            errno.ENOTDIR: (400, "invalid_entry_operation", "A operação exige um diretório."),
            errno.EINVAL: (400, "invalid_entry_operation", "A operação solicitada não é válida."),
        }
        if exc.errno in remote_errors:
            status_code, code, message = remote_errors[exc.errno]
            raise ApiError(status_code, code, message) from exc
        raise ApiError(502, "sftp_unavailable", "Não foi possível concluir a operação SFTP.") from exc
    if isinstance(exc, paramiko.SSHException):
        raise ApiError(502, "sftp_unavailable", "Não foi possível estabelecer a conexão SFTP.") from exc
    raise exc


class _SftpStreamingSession:
    def __init__(self, ssh: paramiko.SSHClient, sftp: paramiko.SFTPClient, remote_file: paramiko.SFTPFile) -> None:
        self._ssh = ssh
        self._sftp = sftp
        self._remote_file = remote_file
        self._file_closed = False
        self._closed = False

    def _close_remote_file(self) -> None:
        if self._file_closed:
            return
        self._file_closed = True
        self._remote_file.close()

    def _close_resources(self) -> None:
        if self._closed:
            return
        self._closed = True
        with suppress(Exception):
            self._close_remote_file()
        with suppress(Exception):
            self._sftp.close()
        with suppress(Exception):
            self._ssh.close()


class SftpDownloadSession(_SftpStreamingSession):
    """Blocking, bounded reader whose connection lives for the HTTP response."""

    def __init__(
        self,
        ssh: paramiko.SSHClient,
        sftp: paramiko.SFTPClient,
        remote_file: paramiko.SFTPFile,
        *,
        size: int,
    ) -> None:
        super().__init__(ssh, sftp, remote_file)
        self.size = size

    def read(self, size: int) -> bytes:
        if self._closed:
            raise RuntimeError("A sessão de download já foi fechada.")
        if size <= 0:
            raise ValueError("O tamanho do chunk deve ser positivo.")
        try:
            return self._remote_file.read(size)
        except Exception as exc:
            self.close()
            _raise_api_error(exc)

    def close(self) -> None:
        self._close_resources()


class SftpUploadSession(_SftpStreamingSession):
    """Blocking writer that publishes a remote temporary sibling on success."""

    def __init__(
        self,
        ssh: paramiko.SSHClient,
        sftp: paramiko.SFTPClient,
        remote_file: paramiko.SFTPFile,
        *,
        path: str,
        temporary_path: str,
    ) -> None:
        super().__init__(ssh, sftp, remote_file)
        self.path = path
        self.temporary_path = temporary_path
        self.bytes_written = 0
        self._finished = False

    def write(self, chunk: bytes) -> int:
        if self._closed:
            raise RuntimeError("A sessão de upload já foi fechada.")
        if not chunk:
            return 0
        try:
            self._remote_file.write(chunk)
        except Exception as exc:
            self.abort()
            _raise_api_error(exc)
        self.bytes_written += len(chunk)
        return len(chunk)

    def finish(self, expected_size: int | None = None) -> int:
        if self._closed:
            raise RuntimeError("A sessão de upload já foi fechada.")
        try:
            # Closing the handle flushes buffered writes and surfaces deferred errors.
            self._close_remote_file()
            if expected_size is not None and self.bytes_written != expected_size:
                raise ApiError(400, "upload_size_mismatch", "O tamanho recebido não corresponde ao Content-Length.")
            attributes = self._sftp.stat(self.temporary_path)
            if attributes.st_size != self.bytes_written:
                raise ApiError(502, "upload_size_mismatch", "O servidor SFTP recebeu um tamanho de arquivo diferente.")
            self._publish_temporary_file()
            self._finished = True
            return self.bytes_written
        except Exception as exc:
            self.abort()
            _raise_api_error(exc)
        finally:
            if self._finished:
                self._close_resources()

    def _publish_temporary_file(self) -> None:
        try:
            self._sftp.posix_rename(self.temporary_path, self.path)
            return
        except OSError as posix_error:
            # Standard SFTP rename is a safe fallback only when no destination
            # exists; it must never delete a valid destination first.
            try:
                self._sftp.lstat(self.path)
            except FileNotFoundError:
                try:
                    self._sftp.rename(self.temporary_path, self.path)
                    return
                except OSError:
                    raise posix_error
            raise posix_error

    def abort(self) -> None:
        if self._closed:
            return
        with suppress(Exception):
            self._close_remote_file()
        try:
            self._sftp.remove(self.temporary_path)
        except FileNotFoundError:
            pass
        except Exception:
            logger.warning("Failed to remove partial remote upload %s", self.temporary_path, exc_info=True)
        self._close_resources()

    def close(self) -> None:
        if not self._finished:
            self.abort()
        else:
            self._close_resources()


class SftpService:
    """Creates short-lived SSH/SFTP connections for individual operations."""

    def __init__(self, connect_timeout: float = 10.0, operation_timeout: float = 30.0) -> None:
        self.connect_timeout = connect_timeout
        self.operation_timeout = operation_timeout

    def _open_connection(
        self, *, host: str, port: int, username: str, password: str
    ) -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
        client = paramiko.SSHClient()
        sftp: paramiko.SFTPClient | None = None
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                hostname=host,
                port=port,
                username=username,
                password=password,
                timeout=self.connect_timeout,
                banner_timeout=self.connect_timeout,
                auth_timeout=self.connect_timeout,
                channel_timeout=self.operation_timeout,
                allow_agent=False,
                look_for_keys=False,
            )
            sftp = client.open_sftp()
            sftp.get_channel().settimeout(self.operation_timeout)
            return client, sftp
        except Exception as exc:
            if sftp is not None:
                with suppress(Exception):
                    sftp.close()
            with suppress(Exception):
                client.close()
            _raise_api_error(exc)

    @contextmanager
    def _connect(self, *, host: str, port: int, username: str, password: str) -> Iterator[paramiko.SFTPClient]:
        client, sftp = self._open_connection(host=host, port=port, username=username, password=password)
        try:
            yield sftp
        except Exception as exc:
            _raise_api_error(exc)
        finally:
            with suppress(Exception):
                sftp.close()
            with suppress(Exception):
                client.close()

    def validate(self, *, host: str, port: int, username: str, password: str) -> SftpValidationResult:
        with self._connect(host=host, port=port, username=username, password=password) as sftp:
            return SftpValidationResult(initial_path=sftp.normalize("."))

    def list_directory(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        path: str,
    ) -> DirectoryListing:
        with self._connect(host=host, port=port, username=username, password=password) as sftp:
            normalized_path = sftp.normalize(path)
            items = [self._to_remote_file(normalized_path, attributes) for attributes in sftp.listdir_attr(normalized_path)]
        items.sort(key=lambda item: (item.kind != "folder", item.name.casefold()))
        return DirectoryListing(path=normalized_path, items=items)

    def download_file(self, *, destination: BinaryIO, path: str, **credentials: object) -> None:
        session = self.open_download(path=path, **credentials)
        try:
            while chunk := session.read(256 * 1024):
                destination.write(chunk)
        finally:
            session.close()

    def upload_file(
        self,
        *,
        source: BinaryIO,
        path: str,
        size: int = 0,
        create_parents: bool = False,
        **credentials: object,
    ) -> None:
        session = self.open_upload(path=path, create_parents=create_parents, **credentials)
        try:
            while chunk := source.read(256 * 1024):
                session.write(chunk)
            session.finish(expected_size=size if size else None)
        except BaseException:
            session.abort()
            raise

    def open_download(self, *, path: str, **credentials: object) -> SftpDownloadSession:
        client, sftp = self._open_connection(**credentials)
        remote_file: paramiko.SFTPFile | None = None
        try:
            attributes = sftp.stat(path)
            if stat.S_ISDIR(attributes.st_mode or 0):
                raise ApiError(400, "file_required", "Selecione um arquivo para baixar.")
            remote_file = sftp.open(path, "rb", bufsize=0)
            return SftpDownloadSession(
                client,
                sftp,
                remote_file,
                size=int(attributes.st_size or 0),
            )
        except Exception as exc:
            if remote_file is not None:
                with suppress(Exception):
                    remote_file.close()
            with suppress(Exception):
                sftp.close()
            with suppress(Exception):
                client.close()
            _raise_api_error(exc)

    def open_upload(
        self,
        *,
        path: str,
        create_parents: bool = False,
        **credentials: object,
    ) -> SftpUploadSession:
        client, sftp = self._open_connection(**credentials)
        remote_file: paramiko.SFTPFile | None = None
        temporary_path: str | None = None
        try:
            destination = PurePosixPath(path)
            if not destination.name:
                raise ApiError(400, "file_required", "Informe um caminho de arquivo para upload.")
            if create_parents:
                self._ensure_directory(sftp, str(destination.parent))
            temporary_path = str(destination.with_name(f".{destination.name}.upload-{uuid.uuid4().hex}"))
            remote_file = sftp.open(temporary_path, "wbx", bufsize=0)
            return SftpUploadSession(
                client,
                sftp,
                remote_file,
                path=path,
                temporary_path=temporary_path,
            )
        except Exception as exc:
            if remote_file is not None:
                with suppress(Exception):
                    remote_file.close()
            if temporary_path is not None:
                with suppress(Exception):
                    sftp.remove(temporary_path)
            with suppress(Exception):
                sftp.close()
            with suppress(Exception):
                client.close()
            _raise_api_error(exc)

    def create_directory(self, *, path: str, parents: bool = False, **credentials: object) -> None:
        with self._connect(**credentials) as sftp:
            if parents:
                self._ensure_directory(sftp, path)
            else:
                sftp.mkdir(path)

    def rename_entry(self, *, path: str, name: str, **credentials: object) -> str:
        destination = str(PurePosixPath(path).with_name(name))
        with self._connect(**credentials) as sftp:
            sftp.rename(path, destination)
        return destination

    def move_entry(self, *, path: str, destination: str, **credentials: object) -> str:
        target = str(PurePosixPath(destination) / PurePosixPath(path).name)
        with self._connect(**credentials) as sftp:
            sftp.rename(path, target)
        return target

    def duplicate_entry(self, *, path: str, **credentials: object) -> str:
        source = PurePosixPath(path)
        with self._connect(**credentials) as sftp:
            destination = self._available_copy_path(sftp, source)
            self._copy_entry(sftp, str(source), destination)
        return destination

    def change_permissions(self, *, path: str, mode: str, **credentials: object) -> None:
        with self._connect(**credentials) as sftp:
            sftp.chmod(path, int(mode, 8))

    def delete_entry(self, *, path: str, **credentials: object) -> None:
        with self._connect(**credentials) as sftp:
            attributes = sftp.lstat(path)
            if stat.S_ISDIR(attributes.st_mode or 0):
                if sftp.listdir(path):
                    raise ApiError(409, "directory_not_empty", "O diretório precisa estar vazio para ser excluído.")
                sftp.rmdir(path)
            else:
                sftp.remove(path)

    @staticmethod
    def _ensure_directory(sftp: paramiko.SFTPClient, path: str) -> None:
        current = PurePosixPath("/") if path.startswith("/") else PurePosixPath()
        for part in PurePosixPath(path).parts:
            if part in {"/", ".", ""}:
                continue
            current /= part
            try:
                sftp.stat(str(current))
            except FileNotFoundError:
                sftp.mkdir(str(current))

    @staticmethod
    def _available_copy_path(sftp: paramiko.SFTPClient, source: PurePosixPath) -> str:
        suffix = source.suffix
        stem = source.name.removesuffix(suffix) if suffix else source.name
        for number in range(1, 10_001):
            marker = " - cópia" if number == 1 else f" - cópia ({number})"
            candidate = str(source.with_name(f"{stem}{marker}{suffix}"))
            try:
                sftp.lstat(candidate)
            except FileNotFoundError:
                return candidate
        raise ApiError(409, "copy_name_unavailable", "Não foi possível escolher um nome para a cópia.")

    @classmethod
    def _copy_entry(cls, sftp: paramiko.SFTPClient, source: str, destination: str) -> None:
        attributes = sftp.lstat(source)
        if stat.S_ISDIR(attributes.st_mode or 0):
            sftp.mkdir(destination)
            for child in sftp.listdir_attr(source):
                cls._copy_entry(
                    sftp,
                    str(PurePosixPath(source) / child.filename),
                    str(PurePosixPath(destination) / child.filename),
                )
            if attributes.st_mode is not None:
                sftp.chmod(destination, stat.S_IMODE(attributes.st_mode))
            return
        with sftp.open(source, "rb") as input_file, sftp.open(destination, "wb") as output_file:
            shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
        if attributes.st_mode is not None:
            sftp.chmod(destination, stat.S_IMODE(attributes.st_mode))

    @staticmethod
    def _to_remote_file(parent: str, attributes: paramiko.SFTPAttributes) -> RemoteFile:
        mode = attributes.st_mode or 0
        kind = _file_kind(attributes.filename, mode)
        modified_at = datetime.fromtimestamp(attributes.st_mtime, UTC) if attributes.st_mtime is not None else None
        return RemoteFile(
            name=attributes.filename,
            path=str(PurePosixPath(parent) / attributes.filename),
            type=_file_type(attributes.filename, kind),
            size=None if kind == "folder" else attributes.st_size,
            modified_at=modified_at,
            permissions=stat.filemode(mode),
            kind=kind,
        )


def _file_kind(filename: str, mode: int) -> FileKind:
    if stat.S_ISDIR(mode):
        return "folder"
    extension = PurePosixPath(filename).suffix.casefold()
    if extension in {".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".c", ".cpp", ".h", ".css", ".html", ".json", ".yaml", ".yml", ".sh", ".md"}:
        return "code"
    if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}:
        return "image"
    if extension in {".mp4", ".mkv", ".avi", ".mov", ".webm"}:
        return "video"
    if extension in {".mp3", ".wav", ".flac", ".ogg", ".m4a"}:
        return "audio"
    if extension in {".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar"}:
        return "archive"
    return "file"


def _file_type(filename: str, kind: FileKind) -> str:
    labels = {
        "folder": "Pasta",
        "code": "Código",
        "image": "Imagem",
        "video": "Vídeo",
        "audio": "Áudio",
        "archive": "Compactado",
        "file": "Arquivo",
    }
    extension = PurePosixPath(filename).suffix.removeprefix(".").upper()
    return extension if extension and kind in {"code", "file"} else labels[kind]
