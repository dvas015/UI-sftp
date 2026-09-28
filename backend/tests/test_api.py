from uuid import uuid4

import anyio
import pytest
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect

from app import api as api_module
from app.api import ManagedStreamingResponse, _close_download_session
from app.errors import ApiError
from app.store import ConnectionRecord


def test_health_does_not_create_session(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
    assert "set-cookie" not in response.headers


def test_create_connection_sets_session_cookie_without_exposing_password(
    client: TestClient,
    connection_payload: dict[str, object],
    sftp_service,
) -> None:
    response = client.post("/api/connections", json=connection_payload)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Servidor de testes"
    assert body["initial_path"] == "/home/deploy"
    assert body["status"] == "connected"
    assert "password" not in body
    assert sftp_service.calls == [
        {"host": "sftp.internal", "port": 22, "username": "deploy", "password": "top-secret"}
    ]

    cookie = response.headers["set-cookie"]
    assert "sftp_session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/api" in cookie
    assert "Max-Age" not in cookie
    assert "Secure" not in cookie
    assert "top-secret" not in response.text


def test_multiple_connections_are_isolated_between_browser_sessions(
    app,
    connection_payload: dict[str, object],
) -> None:
    with TestClient(app) as first, TestClient(app) as second:
        first.post("/api/connections", json=connection_payload)
        first.post("/api/connections", json=connection_payload | {"name": "Outro"})

        assert len(first.get("/api/connections").json()) == 2
        assert second.get("/api/connections").json() == []


def test_list_remote_files_uses_selected_connection_credentials(
    client: TestClient,
    connection_payload: dict[str, object],
    sftp_service,
) -> None:
    created = client.post("/api/connections", json=connection_payload).json()

    response = client.get(f"/api/connections/{created['id']}/files", params={"path": "/var/log"})

    assert response.status_code == 200
    assert response.json() == {"path": "/var/log", "items": []}
    assert sftp_service.calls[-1] == {
        "operation": "list",
        "host": "sftp.internal",
        "port": 22,
        "username": "deploy",
        "password": "top-secret",
        "path": "/var/log",
    }


def test_disconnected_connection_cannot_list_files(
    client: TestClient,
    connection_payload: dict[str, object],
) -> None:
    created = client.post("/api/connections", json=connection_payload).json()
    client.post(f"/api/connections/{created['id']}/disconnect")

    response = client.get(f"/api/connections/{created['id']}/files")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "connection_disconnected"


def test_failed_validation_does_not_create_connection_or_cookie(
    client: TestClient,
    connection_payload: dict[str, object],
    sftp_service,
) -> None:
    sftp_service.error = ApiError(401, "authentication_failed", "Usuário ou senha SFTP inválidos.")

    response = client.post("/api/connections", json=connection_payload)

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "authentication_failed", "message": "Usuário ou senha SFTP inválidos."}
    }
    assert "set-cookie" not in response.headers
    assert client.get("/api/connections").json() == []


def test_disconnect_reconnect_edit_and_delete_are_atomic(
    client: TestClient,
    connection_payload: dict[str, object],
    sftp_service,
) -> None:
    created = client.post("/api/connections", json=connection_payload).json()
    connection_id = created["id"]

    disconnected = client.post(f"/api/connections/{connection_id}/disconnect")
    assert disconnected.json()["status"] == "disconnected"

    name_only = client.patch(f"/api/connections/{connection_id}", json={"name": "Produção"})
    assert name_only.json()["name"] == "Produção"
    assert len(sftp_service.calls) == 1

    requires_password = client.patch(f"/api/connections/{connection_id}", json={"host": "new.internal"})
    assert requires_password.status_code == 400
    assert requires_password.json()["error"]["code"] == "password_required"

    sftp_service.error = ApiError(401, "authentication_failed", "Usuário ou senha SFTP inválidos.")
    failed = client.post(f"/api/connections/{connection_id}/connect", json={"password": "wrong"})
    assert failed.status_code == 401
    assert client.get(f"/api/connections/{connection_id}").json()["status"] == "disconnected"

    sftp_service.error = None
    reconnected = client.post(f"/api/connections/{connection_id}/connect", json={"password": "new-secret"})
    assert reconnected.json()["status"] == "connected"

    sftp_service.error = ApiError(502, "sftp_unavailable", "Não foi possível estabelecer a conexão SFTP.")
    failed_edit = client.patch(f"/api/connections/{connection_id}", json={"host": "broken.internal"})
    assert failed_edit.status_code == 502
    assert client.get(f"/api/connections/{connection_id}").json()["host"] == "sftp.internal"

    assert client.delete(f"/api/connections/{connection_id}").status_code == 204
    assert client.get(f"/api/connections/{connection_id}").status_code == 404


def test_delete_session_removes_everything_and_invalidates_cookie(
    client: TestClient,
    connection_payload: dict[str, object],
) -> None:
    client.post("/api/connections", json=connection_payload)
    response = client.delete("/api/session")

    assert response.status_code == 204
    assert "sftp_session=\"\"" in response.headers["set-cookie"]
    assert client.get("/api/connections").json() == []


def test_validation_errors_use_standard_shape(client: TestClient) -> None:
    response = client.post(
        "/api/connections",
        json={"host": "", "port": 70000, "username": "", "password": ""},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid_request", "message": "Dados de entrada inválidos."}
    }


def test_unexpected_errors_do_not_leak_password(app, connection_payload, sftp_service, caplog) -> None:
    sftp_service.error = RuntimeError("top-secret")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/api/connections", json=connection_payload)

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "top-secret" not in response.text
    assert "top-secret" not in caplog.text


def test_internal_record_repr_does_not_expose_password() -> None:
    record = ConnectionRecord(
        name="Servidor",
        host="sftp.internal",
        port=22,
        username="deploy",
        initial_path="/home/deploy",
        password="top-secret",
    )

    assert "top-secret" not in repr(record)


def test_streaming_response_closes_session_and_releases_lock_on_disconnect() -> None:
    class Session:
        closed = False

        def close(self) -> None:
            self.closed = True

    async def scenario() -> None:
        record = ConnectionRecord(
            name="Servidor", host="sftp.internal", port=22, username="deploy",
            initial_path="/home/deploy", password="top-secret",
        )
        session = Session()
        await record.operation_lock.acquire()

        async def content():
            yield b"first-chunk"

        async def send(message) -> None:
            if message["type"] == "http.response.body":
                raise OSError("client disconnected")

        async def receive():
            return {"type": "http.disconnect"}

        response = ManagedStreamingResponse(
            content(), cleanup=lambda: _close_download_session(session, record),
        )
        with pytest.raises(ClientDisconnect):
            await response(
                {"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send,
            )

        assert session.closed is True
        assert record.operation_lock.locked() is False

    anyio.run(scenario)


def test_upload_disconnect_aborts_remote_partial_and_releases_lock(monkeypatch) -> None:
    class Session:
        aborted = False

        def write(self, _chunk: bytes) -> int:
            return len(_chunk)

        def finish(self, _expected_size: int | None = None) -> int:
            raise AssertionError("finish must not run after a disconnect")

        def abort(self) -> None:
            self.aborted = True

    class Service:
        def open_upload(self, **_kwargs):
            return session

    class StreamingRequest:
        headers = {"content-type": "application/octet-stream"}

        async def stream(self):
            yield b"partial"
            raise ClientDisconnect()

    record = ConnectionRecord(
        name="Servidor", host="sftp.internal", port=22, username="deploy",
        initial_path="/home/deploy", password="top-secret",
    )
    session = Session()
    service = Service()
    monkeypatch.setattr(api_module, "_connection", lambda _request, _connection_id: record)
    monkeypatch.setattr(api_module, "_sftp", lambda _request: service)

    async def scenario() -> None:
        with pytest.raises(ClientDisconnect):
            await api_module.upload_remote_file(
                record.id, StreamingRequest(), path="/remote/file.bin", create_parents=False,
            )
        assert session.aborted is True
        assert record.operation_lock.locked() is False

    anyio.run(scenario)


def test_file_management_endpoints_use_selected_connection(
    client: TestClient,
    connection_payload: dict[str, object],
    sftp_service,
) -> None:
    connection_id = client.post("/api/connections", json=connection_payload).json()["id"]
    prefix = f"/api/connections/{connection_id}"

    transfer_id = uuid4()
    download = client.get(
        f"{prefix}/files/download",
        params={"path": "/remote/report.txt", "transfer_id": str(transfer_id)},
    )
    assert download.status_code == 200
    assert download.content == b"downloaded-content"
    assert "filename*=UTF-8''report.txt" in download.headers["content-disposition"]
    assert download.headers["content-length"] == str(len(b"downloaded-content"))
    progress = client.get(f"/api/downloads/{transfer_id}")
    assert progress.status_code == 200
    assert progress.json() == {
        "id": str(transfer_id),
        "status": "completed",
        "bytes_transferred": len(b"downloaded-content"),
        "total_bytes": len(b"downloaded-content"),
        "error": None,
    }

    upload = client.post(
        f"{prefix}/files/upload",
        params={"path": "/remote/folder/report.txt", "create_parents": "true"},
        content=b"uploaded-content",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert upload.status_code == 204
    assert client.post(f"{prefix}/directories", json={"path": "/remote/new"}).status_code == 204

    renamed = client.patch(
        f"{prefix}/entries/rename", json={"path": "/remote/report.txt", "name": "renamed.txt"},
    )
    assert renamed.json() == {"path": "/remote/renamed.txt"}

    moved = client.post(
        f"{prefix}/entries/move", json={"path": "/remote/renamed.txt", "destination": "/archive"},
    )
    assert moved.json() == {"path": "/archive/renamed.txt"}

    duplicated = client.post(f"{prefix}/entries/duplicate", json={"path": "/remote/renamed.txt"})
    assert duplicated.json() == {"path": "/remote/renamed.txt - cópia"}
    assert client.patch(
        f"{prefix}/entries/permissions", json={"path": "/remote/renamed.txt", "mode": "0644"},
    ).status_code == 204
    assert client.post(
        f"{prefix}/entries/delete", json={"path": "/remote/renamed.txt"},
    ).status_code == 204

    operations = [call.get("operation") for call in sftp_service.calls[1:]]
    assert operations == ["download", "upload", "mkdir", "rename", "move", "duplicate", "chmod", "delete"]
    upload_call = sftp_service.calls[2]
    assert upload_call["content"] == b"uploaded-content"
    assert upload_call["create_parents"] is True


def test_upload_rejects_multipart_staging_contract(
    client: TestClient,
    connection_payload: dict[str, object],
) -> None:
    connection_id = client.post("/api/connections", json=connection_payload).json()["id"]

    response = client.post(
        f"/api/connections/{connection_id}/files/upload",
        params={"path": "/remote/report.txt"},
        files={"file": ("report.txt", b"uploaded-content", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media_type"


def test_download_progress_is_private_to_browser_session(app, connection_payload) -> None:
    transfer_id = uuid4()
    with TestClient(app) as owner, TestClient(app) as another_browser:
        connection_id = owner.post("/api/connections", json=connection_payload).json()["id"]
        response = owner.get(
            f"/api/connections/{connection_id}/files/download",
            params={"path": "/remote/report.txt", "transfer_id": str(transfer_id)},
        )

        assert response.status_code == 200
        assert owner.get(f"/api/downloads/{transfer_id}").status_code == 200
        assert another_browser.get(f"/api/downloads/{transfer_id}").status_code == 404


def test_file_management_requires_connected_session(
    client: TestClient,
    connection_payload: dict[str, object],
) -> None:
    connection_id = client.post("/api/connections", json=connection_payload).json()["id"]
    client.post(f"/api/connections/{connection_id}/disconnect")

    response = client.post(
        f"/api/connections/{connection_id}/directories", json={"path": "/remote/new"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "connection_disconnected"


def test_entry_mutation_validation_uses_standard_error_shape(
    client: TestClient,
    connection_payload: dict[str, object],
) -> None:
    connection_id = client.post("/api/connections", json=connection_payload).json()["id"]

    invalid_name = client.patch(
        f"/api/connections/{connection_id}/entries/rename",
        json={"path": "/remote/report.txt", "name": "../escape.txt"},
    )
    invalid_mode = client.patch(
        f"/api/connections/{connection_id}/entries/permissions",
        json={"path": "/remote/report.txt", "mode": "999"},
    )

    assert invalid_name.status_code == 422
    assert invalid_name.json()["error"]["code"] == "invalid_request"
    assert invalid_mode.status_code == 422
