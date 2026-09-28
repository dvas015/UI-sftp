import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import router
from .errors import ApiError
from .sftp import SftpService
from .store import SessionStore
from .transfers import DownloadTracker


APP_VERSION = "0.1.0"
logger = logging.getLogger("sftp_explorer.api")


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


def create_app(
    *,
    session_store: SessionStore | None = None,
    sftp_service: SftpService | None = None,
    download_tracker: DownloadTracker | None = None,
) -> FastAPI:
    application = FastAPI(title="SFTP Explorer API", version=APP_VERSION)
    application.state.session_store = session_store or SessionStore()
    application.state.sftp_service = sftp_service or SftpService()
    application.state.download_tracker = download_tracker or DownloadTracker()
    application.include_router(router)

    @application.exception_handler(ApiError)
    async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(exc.status_code, exc.code, exc.message)

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return _error_response(422, "invalid_request", "Dados de entrada inválidos.")

    @application.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "route_not_found" if exc.status_code == 404 else "http_error"
        message = "Rota não encontrada." if exc.status_code == 404 else "A requisição não pôde ser processada."
        return _error_response(exc.status_code, code, message)

    @application.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("Unexpected API error of type %s", type(exc).__name__)
        return _error_response(500, "internal_error", "Ocorreu um erro interno.")

    return application


app = create_app()

