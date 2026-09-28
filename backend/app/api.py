import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import quote
from uuid import UUID

import anyio
from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

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
TRANSFER_CHUNK_SIZE = 128 * 1024
logger = logging.getLogger("sftp_explorer.transfer")
router = APIRouter(prefix="/api")


class ManagedStreamingResponse(StreamingResponse):
    """Streaming response that deterministically releases external resources."""

    def __init__(self, *args: object, cleanup: Callable[[], Awaitable[None]], **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self._cleanup = cleanup

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self._cleanup()


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
    with connection.lock:
        if connection.password is None:
            raise ApiError(409, "connection_disconnected", "Reconecte ao servidor antes de acessar os arquivos.")
    return connection


def _credentials(connection: ConnectionRecord) -> dict[str, object]:
    with connection.lock:
        if connection.password is None:
            raise ApiError(409, "connection_disconnected", "Reconecte ao servidor antes de acessar os arquivos.")
        return {
            "host": connection.host,
            "port": connection.port,
            "username": connection.username,
            "password": connection.password,
        }


async def _acquire_operation_lock(connection: ConnectionRecord) -> None:
    await connection.operation_lock.acquire()


async def _close_download_session(session: object, connection: ConnectionRecord) -> None:
    try:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(session.close)  # type: ignore[attr-defined]
    except Exception:
        logger.warning("Failed to close SFTP download session", exc_info=True)
    finally:
        connection.operation_lock.release()


async def _download_chunks(session: object, connection: ConnectionRecord, path: str):
    remaining = session.size  # type: ignore[attr-defined]
    try:
        while remaining > 0:
            chunk = await run_in_threadpool(  # type: ignore[attr-defined]
                session.read, min(TRANSFER_CHUNK_SIZE, remaining),
            )
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    except BaseException:
        logger.info("SFTP download interrupted for %s", path, exc_info=True)
        raise


async def _run_sftp_operation(connection: ConnectionRecord, operation, **kwargs):
    async with connection.operation_lock:
        return await run_in_threadpool(operation, **_credentials(connection), **kwargs)


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
async def list_remote_files(connection_id: UUID, request: Request, path: str | None = None) -> DirectoryListing:
    connection = _connection(request, connection_id)
    async with connection.operation_lock:
        with connection.lock:
            remote_path = path or connection.initial_path
        return await run_in_threadpool(
            _sftp(request).list_directory,
            **_credentials(connection),
            path=remote_path,
        )


@router.get("/connections/{connection_id}/files/download", response_class=StreamingResponse)
async def download_remote_file(
    connection_id: UUID,
    request: Request,
    path: str = Query(min_length=1),
) -> StreamingResponse:
    connection = _connection(request, connection_id)
    await _acquire_operation_lock(connection)
    try:
        session = await run_in_threadpool(
            _sftp(request).open_download,
            **_credentials(connection),
            path=path,
        )
    except BaseException:
        connection.operation_lock.release()
        raise

    filename = quote(PurePosixPath(path).name, safe="")
    return ManagedStreamingResponse(
        _download_chunks(session, connection, path),
        media_type="application/octet-stream",
        cleanup=lambda: _close_download_session(session, connection),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "Content-Length": str(session.size),
        },
    )


@router.post("/connections/{connection_id}/files/upload", status_code=status.HTTP_204_NO_CONTENT)
async def upload_remote_file(
    connection_id: UUID,
    request: Request,
    path: str = Query(min_length=1),
    create_parents: bool = False,
) -> None:
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type != "application/octet-stream":
        raise ApiError(415, "unsupported_media_type", "Envie o arquivo como application/octet-stream.")

    raw_content_length = request.headers.get("content-length")
    try:
        expected_size = int(raw_content_length) if raw_content_length is not None else None
    except ValueError as exc:
        raise ApiError(400, "invalid_content_length", "O tamanho informado para o arquivo é inválido.") from exc
    if expected_size is not None and expected_size < 0:
        raise ApiError(400, "invalid_content_length", "O tamanho informado para o arquivo é inválido.")

    connection = _connection(request, connection_id)
    await _acquire_operation_lock(connection)
    session = None
    try:
        session = await run_in_threadpool(
            _sftp(request).open_upload,
            **_credentials(connection),
            path=path,
            create_parents=create_parents,
        )
        received = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            received += len(chunk)
            if expected_size is not None and received > expected_size:
                raise ApiError(400, "upload_size_mismatch", "O conteúdo recebido excede o tamanho informado.")
            for offset in range(0, len(chunk), TRANSFER_CHUNK_SIZE):
                await run_in_threadpool(session.write, chunk[offset:offset + TRANSFER_CHUNK_SIZE])
        await run_in_threadpool(session.finish, expected_size)
        session = None
    except BaseException:
        if session is not None:
            with anyio.CancelScope(shield=True):
                await run_in_threadpool(session.abort)
        raise
    finally:
        connection.operation_lock.release()


@router.post("/connections/{connection_id}/directories", status_code=status.HTTP_204_NO_CONTENT)
async def create_remote_directory(connection_id: UUID, payload: PathRequest, request: Request) -> None:
    connection = _connection(request, connection_id)
    await _run_sftp_operation(connection, _sftp(request).create_directory, path=payload.path)


@router.patch("/connections/{connection_id}/entries/rename", response_model=EntryOperationResult)
async def rename_remote_entry(
    connection_id: UUID, payload: RenameEntryRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    path = await _run_sftp_operation(
        connection, _sftp(request).rename_entry, path=payload.path, name=payload.name,
    )
    return EntryOperationResult(path=path)


@router.post("/connections/{connection_id}/entries/move", response_model=EntryOperationResult)
async def move_remote_entry(
    connection_id: UUID, payload: MoveEntryRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    path = await _run_sftp_operation(
        connection, _sftp(request).move_entry, path=payload.path, destination=payload.destination,
    )
    return EntryOperationResult(path=path)


@router.post("/connections/{connection_id}/entries/duplicate", response_model=EntryOperationResult)
async def duplicate_remote_entry(
    connection_id: UUID, payload: PathRequest, request: Request,
) -> EntryOperationResult:
    connection = _connection(request, connection_id)
    path = await _run_sftp_operation(connection, _sftp(request).duplicate_entry, path=payload.path)
    return EntryOperationResult(path=path)


@router.patch("/connections/{connection_id}/entries/permissions", status_code=status.HTTP_204_NO_CONTENT)
async def change_remote_permissions(
    connection_id: UUID, payload: PermissionsUpdateRequest, request: Request,
) -> None:
    connection = _connection(request, connection_id)
    await _run_sftp_operation(
        connection, _sftp(request).change_permissions, path=payload.path, mode=payload.mode,
    )


@router.post("/connections/{connection_id}/entries/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_remote_entry(connection_id: UUID, payload: PathRequest, request: Request) -> None:
    connection = _connection(request, connection_id)
    await _run_sftp_operation(connection, _sftp(request).delete_entry, path=payload.path)


@router.patch("/connections/{connection_id}", response_model=ConnectionPublic)
async def update_connection(
    connection_id: UUID,
    payload: ConnectionUpdate,
    request: Request,
) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    supplied = payload.model_fields_set
    connection_fields = {"host", "port", "username", "password"}

    async with connection.operation_lock:
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

        validation = await run_in_threadpool(
            _sftp(request).validate,
            host=next_host,
            port=next_port,
            username=next_username,
            password=next_password,
        )
        with connection.lock:
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
async def disconnect_connection(connection_id: UUID, request: Request) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    async with connection.operation_lock:
        with connection.lock:
            connection.password = None
            connection.status = "disconnected"
            return connection.public()


@router.post("/connections/{connection_id}/connect", response_model=ConnectionPublic)
async def reconnect_connection(
    connection_id: UUID,
    payload: ReconnectRequest,
    request: Request,
) -> ConnectionPublic:
    store = _store(request)
    session = store.get_session(_session_id(request))
    connection = store.get_connection(session, connection_id)
    password = payload.password.get_secret_value()

    async with connection.operation_lock:
        with connection.lock:
            host = connection.host
            port = connection.port
            username = connection.username
        validation = await run_in_threadpool(
            _sftp(request).validate,
            host=host,
            port=port,
            username=username,
            password=password,
        )
        with connection.lock:
            connection.password = password
            connection.initial_path = validation.initial_path
            connection.status = "connected"
            connection.last_verified_at = datetime.now(UTC)
            return connection.public()


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(connection_id: UUID, request: Request) -> None:
    store = _store(request)
    session = store.get_session(_session_id(request))
    await store.delete_connection(session, connection_id)


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(request: Request, response: Response) -> None:
    await _store(request).clear_session(_session_id(request))
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/api",
        httponly=True,
        secure=False,
        samesite="strict",
    )
