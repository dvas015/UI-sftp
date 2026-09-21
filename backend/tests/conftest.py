from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import DirectoryListing
from app.sftp import SftpValidationResult
from app.store import SessionStore


class FakeSftpService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.error: Exception | None = None

    def validate(self, *, host: str, port: int, username: str, password: str) -> SftpValidationResult:
        self.calls.append({"host": host, "port": port, "username": username, "password": password})
        if self.error is not None:
            raise self.error
        return SftpValidationResult(initial_path=f"/home/{username}")

    def list_directory(self, *, host: str, port: int, username: str, password: str, path: str) -> DirectoryListing:
        self.calls.append({
            "operation": "list",
            "host": host,
            "port": port,
            "username": username,
            "password": password,
            "path": path,
        })
        if self.error is not None:
            raise self.error
        return DirectoryListing(path=path, items=[])

    def download_file(self, *, destination, path: str, **credentials) -> None:
        self.calls.append({"operation": "download", "path": path, **credentials})
        destination.write(b"downloaded-content")

    def upload_file(self, *, source, path: str, size: int, create_parents: bool, **credentials) -> None:
        self.calls.append({
            "operation": "upload", "path": path, "size": size,
            "create_parents": create_parents, "content": source.read(), **credentials,
        })

    def create_directory(self, *, path: str, **credentials) -> None:
        self.calls.append({"operation": "mkdir", "path": path, **credentials})

    def rename_entry(self, *, path: str, name: str, **credentials) -> str:
        self.calls.append({"operation": "rename", "path": path, "name": name, **credentials})
        return f"/remote/{name}"

    def move_entry(self, *, path: str, destination: str, **credentials) -> str:
        self.calls.append({"operation": "move", "path": path, "destination": destination, **credentials})
        return f"{destination}/{path.rsplit('/', 1)[-1]}"

    def duplicate_entry(self, *, path: str, **credentials) -> str:
        self.calls.append({"operation": "duplicate", "path": path, **credentials})
        return f"{path} - cópia"

    def change_permissions(self, *, path: str, mode: str, **credentials) -> None:
        self.calls.append({"operation": "chmod", "path": path, "mode": mode, **credentials})

    def delete_entry(self, *, path: str, **credentials) -> None:
        self.calls.append({"operation": "delete", "path": path, **credentials})


@pytest.fixture
def sftp_service() -> FakeSftpService:
    return FakeSftpService()


@pytest.fixture
def app(sftp_service: FakeSftpService):
    return create_app(session_store=SessionStore(), sftp_service=sftp_service)


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def connection_payload() -> dict[str, object]:
    return {
        "name": "Servidor de testes",
        "host": "sftp.internal",
        "port": 22,
        "username": "deploy",
        "password": "top-secret",
    }
