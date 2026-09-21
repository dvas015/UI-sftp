from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from tempfile import NamedTemporaryFile
from uuid import UUID

from fastapi import APIRouter, File, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from .errors import ApiError
from .models import (
    ConnectionCreate,
    ConnectionPublic,
    ConnectionUpdate,
    DirectoryListing,
    EntryOperationResult,
    HealthResponse,
    MoveEntryRequest,
    PathRequest,
    PermissionsUpdateRequest,
    ReconnectRequest,
    RenameEntryRequest,
)
from .sftp import SftpService
from .store import ConnectionRecord, SessionStore


SESSION_COOKIE = "sftp_session"
router = APIRouter(prefix="/api")


def _store(request: Request) -> SessionStore:
    return request.app.state.session_store


def _sftp(request: Request) -> SftpService:
    return request.app.state.sftp_service


def _session_id(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE)


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=True,
        secure=False,
        samesite="strict",
        path="/api",
    )


def _connection(request: Request, connection_id: UUID) -> ConnectionRecord:
    store = _store(request)
    connection = store.get_connection(store.get_session(_session_id(request)), connection_id)
    if connection.password is None:
        raise ApiError(409, "connection_disconnected", "Reconecte ao servidor antes de acessar os arquivos.")
    return connection


def _credentials(connection: ConnectionRecord) -> dict[str, object]:
    return {
        "host": connection.host,
        "port": connection.port,
        "username": connection.username,
        "password": connection.password,
    }


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    return HealthResponse(version=request.app.version)


@router.post("/connections", response_model=ConnectionPublic, status_code=status.HTTP_201_CREATED)
def create_connection(payload: ConnectionCreate, request: Request, response: Response) -> ConnectionPublic:
    service = _sftp(request)
    password = payload.password.get_secret_value()
    validation = service.validate(
        host=payload.host,
        port=payload.port,
        username=payload.username,
        password=password,
    )

    store = _store(request)
    session_id, session, created = store.ensure_session(_session_id(request))
    connection = ConnectionRecord(
        name=payload.name or payload.host,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        password=password,
        initial_path=validation.initial_path,
    )
    store.add_connection(session, connection)
    if created:
        _set_session_cookie(response, session_id)
    return connection.public()


@router.get("/connections", response_model=list[ConnectionPublic])
def list_connections(request: Request) -> list[ConnectionPublic]:
    store = _store(request)
    return store.list_connections(store.get_session(_session_id(request)))


@router.get("/connections/{connection_id}", response_model=ConnectionPublic)
def get_connection(connection_id: UUID, request: Request) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    return store.get_connection(session, connection_id).public()


@router.get("/connections/{connection_id}/files", response_model=DirectoryListing)
def list_remote_files(connection_id: UUID, request: Request, path: str | None = None) -> DirectoryListing:
    connection = _connection(request, connection_id)
    with connection.lock:
        return _sftp(request).list_directory(
            **_credentials(connection),
            path=path or connection.initial_path,
        )


@router.get("/connections/{connection_id}/files/download", response_class=FileResponse)
def download_remote_file(connection_id: UUID, request: Request, path: str = Query(min_length=1)) -> FileResponse:
    connection = _connection(request, connection_id)
    temporary = NamedTemporaryFile(prefix="sftp-explorer-", delete=False)
    temporary_path = Path(temporary.name)
    temporary.close()
    try:
        with connection.lock, temporary_path.open("wb") as destination:
            _sftp(request).download_file(
                **_credentials(connection), path=path, destination=destination,
            )
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return FileResponse(
        temporary_path,
        filename=PurePosixPath(path).name,
        background=BackgroundTask(temporary_path.unlink, missing_ok=True),
    )


@router.post("/connections/{connection_id}/files/upload", status_code=status.HTTP_204_NO_CONTENT)
def upload_remote_file(
    connection_id: UUID,
    request: Request,
    path: str = Query(min_length=1),
    create_parents: bool = False,
    file: UploadFile = File(),
) -> None:
    connection = _connection(request, connection_id)
    with connection.lock:
        _sftp(request).upload_file(
            **_credentials(connection),
            source=file.file,
            path=path,
            size=file.size or 0,
            create_parents=create_parents,
        )


@router.post("/connections/{connection_id}/directories", status_code=status.HTTP_204_NO_CONTENT)
def create_remote_directory(connection_id: UUID, payload: PathRequest, request: Request) -> None:
    connection = _connection(request, connection_id)
    with connection.lock:
        _sftp(request).create_directory(**_credentials(connection), path=payload.path)


@router.patch("/connections/{connection_id}/entries/rename", response_model=EntryOperationResult)
def rename_remote_entry(
    connection_id: UUID, payload: RenameEntryRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    with connection.lock:
        path = _sftp(request).rename_entry(**_credentials(connection), path=payload.path, name=payload.name)
    return EntryOperationResult(path=path)


@router.post("/connections/{connection_id}/entries/move", response_model=EntryOperationResult)
def move_remote_entry(
    connection_id: UUID, payload: MoveEntryRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    with connection.lock:
        path = _sftp(request).move_entry(
            **_credentials(connection), path=payload.path, destination=payload.destination,
        )
    return EntryOperationResult(path=path)


@router.post("/connections/{connection_id}/entries/duplicate", response_model=EntryOperationResult)
def duplicate_remote_entry(
    connection_id: UUID, payload: PathRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    with connection.lock:
        path = _sftp(request).duplicate_entry(**_credentials(connection), path=payload.path)
    return EntryOperationResult(path=path)


@router.patch("/connections/{connection_id}/entries/permissions", status_code=status.HTTP_204_NO_CONTENT)
def change_remote_permissions(
    connection_id: UUID, payload: PermissionsUpdateRequest, request: Request,
) -> None:
    connection = _connection(request, connection_id)
    with connection.lock:
        _sftp(request).change_permissions(
            **_credentials(connection), path=payload.path, mode=payload.mode,
        )


@router.post("/connections/{connection_id}/entries/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_remote_entry(connection_id: UUID, payload: PathRequest, request: Request) -> None:
    connection = _connection(request, connection_id)
    with connection.lock:
        _sftp(request).delete_entry(**_credentials(connection), path=payload.path)


@router.patch("/connections/{connection_id}", response_model=ConnectionPublic)
def update_connection(
    connection_id: UUID,
    payload: ConnectionUpdate,
    request: Request,
) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    supplied = payload.model_fields_set
    connection_fields = {"host", "port", "username", "password"}

    with connection.lock:
        if not supplied:
            return connection.public()

        next_name = payload.name if "name" in supplied and payload.name is not None else connection.name
        if not supplied.intersection(connection_fields):
            connection.name = next_name
            return connection.public()

        next_host = payload.host if "host" in supplied and payload.host is not None else connection.host
        next_port = payload.port if "port" in supplied and payload.port is not None else connection.port
        next_username = payload.username if "username" in supplied and payload.username is not None else connection.username
        next_password = (
            payload.password.get_secret_value()
            if "password" in supplied and payload.password is not None
            else connection.password
        )
        if next_password is None:
            raise ApiError(400, "password_required", "Informe a senha para validar esta alteração.")

        validation = _sftp(request).validate(
            host=next_host,
            port=next_port,
            username=next_username,
            password=next_password,
        )
        connection.name = next_name
        connection.host = next_host
        connection.port = next_port
        connection.username = next_username
        connection.password = next_password
        connection.initial_path = validation.initial_path
        connection.status = "connected"
        connection.last_verified_at = datetime.now(UTC)
        return connection.public()


@router.post("/connections/{connection_id}/disconnect", response_model=ConnectionPublic)
def disconnect_connection(connection_id: UUID, request: Request) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    with connection.lock:
        connection.password = None
        connection.status = "disconnected"
        return connection.public()


@router.post("/connections/{connection_id}/connect", response_model=ConnectionPublic)
def reconnect_connection(
    connection_id: UUID,
    payload: ReconnectRequest,
    request: Request,
) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    password = payload.password.get_secret_value()

    with connection.lock:
        validation = _sftp(request).validate(
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
        )
        connection.password = password
        connection.initial_path = validation.initial_path
        connection.status = "connected"
        connection.last_verified_at = datetime.now(UTC)
        return connection.public()


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: UUID, request: Request) -> None:
    store = _store(request)
    session = store.get_session(_session_id(request))
    store.delete_connection(session, connection_id)


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(request: Request, response: Response) -> None:
    _store(request).clear_session(_session_id(request))
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/api",
        httponly=True,
        secure=False,
        samesite="strict",
    )
