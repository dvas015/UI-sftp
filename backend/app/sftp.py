import errno
import socket
import stat
import shutil
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import BinaryIO, Iterator
from contextlib import contextmanager

import paramiko

from .errors import ApiError
from .models import DirectoryListing, FileKind, RemoteFile


@dataclass(frozen=True, slots=True)
class SftpValidationResult:
    initial_path: str


class SftpService:
    """Creates short-lived SSH/SFTP connections for individual operations."""

    def __init__(self, connect_timeout: float = 10.0, operation_timeout: float = 30.0) -> None:
        self.connect_timeout = connect_timeout
        self.operation_timeout = operation_timeout

    @contextmanager
    def _connect(self, *, host: str, port: int, username: str, password: str) -> Iterator[paramiko.SFTPClient]:
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
            yield sftp
        except paramiko.AuthenticationException as exc:
            raise ApiError(401, "authentication_failed", "Usuário ou senha SFTP inválidos.") from exc
        except (socket.timeout, TimeoutError) as exc:
            raise ApiError(504, "sftp_timeout", "O servidor SFTP não respondeu dentro do tempo limite.") from exc
        except PermissionError as exc:
            raise ApiError(403, "permission_denied", "A conta não possui permissão para acessar este caminho.") from exc
        except FileNotFoundError as exc:
            raise ApiError(404, "remote_path_not_found", "O caminho remoto não foi encontrado.") from exc
        except OSError as exc:
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
        except paramiko.SSHException as exc:
            raise ApiError(502, "sftp_unavailable", "Não foi possível estabelecer a conexão SFTP.") from exc
        finally:
            if sftp is not None:
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
        with self._connect(**credentials) as sftp:
            attributes = sftp.stat(path)
            if stat.S_ISDIR(attributes.st_mode or 0):
                raise ApiError(400, "file_required", "Selecione um arquivo para baixar.")
            sftp.getfo(path, destination)

    def upload_file(
        self,
        *,
        source: BinaryIO,
        path: str,
        size: int = 0,
        create_parents: bool = False,
        **credentials: object,
    ) -> None:
        with self._connect(**credentials) as sftp:
            if create_parents:
                self._ensure_directory(sftp, str(PurePosixPath(path).parent))
            sftp.putfo(source, path, file_size=size, confirm=True)

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
