from dataclasses import dataclass, field
from datetime import UTC, datetime
from secrets import token_urlsafe
from threading import RLock
from uuid import UUID, uuid4

from .errors import ApiError
from .models import ConnectionPublic, ConnectionStatus


@dataclass(slots=True)
class ConnectionRecord:
    name: str
    host: str
    port: int
    username: str
    initial_path: str
    password: str | None = field(repr=False)
    id: UUID = field(default_factory=uuid4)
    status: ConnectionStatus = "connected"
    last_verified_at: datetime | None = field(default_factory=lambda: datetime.now(UTC))
    lock: RLock = field(default_factory=RLock, repr=False)

    def public(self) -> ConnectionPublic:
        with self.lock:
            return ConnectionPublic(
                id=self.id,
                name=self.name,
                host=self.host,
                port=self.port,
                username=self.username,
                initial_path=self.initial_path,
                status=self.status,
                last_verified_at=self.last_verified_at,
            )


@dataclass(slots=True)
class BrowserSession:
    connections: dict[UUID, ConnectionRecord] = field(default_factory=dict)
    lock: RLock = field(default_factory=RLock, repr=False)


class SessionStore:
    """Thread-safe, process-local storage for browser sessions and credentials."""

    def __init__(self) -> None:
        self._sessions: dict[str, BrowserSession] = {}
        self._lock = RLock()

    def ensure_session(self, requested_id: str | None) -> tuple[str, BrowserSession, bool]:
        with self._lock:
            if requested_id:
                session = self._sessions.get(requested_id)
                if session is not None:
                    return requested_id, session, False

            session_id = token_urlsafe(32)
            session = BrowserSession()
            self._sessions[session_id] = session
            return session_id, session, True

    def get_session(self, session_id: str | None) -> BrowserSession | None:
        if not session_id:
            return None
        with self._lock:
            return self._sessions.get(session_id)

    def clear_session(self, session_id: str | None) -> None:
        if not session_id:
            return
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is not None:
            with session.lock:
                for connection in session.connections.values():
                    with connection.lock:
                        connection.password = None
                session.connections.clear()

    @staticmethod
    def add_connection(session: BrowserSession, connection: ConnectionRecord) -> None:
        with session.lock:
            session.connections[connection.id] = connection

    @staticmethod
    def list_connections(session: BrowserSession | None) -> list[ConnectionPublic]:
        if session is None:
            return []
        with session.lock:
            records = list(session.connections.values())
        return [record.public() for record in records]

    @staticmethod
    def get_connection(session: BrowserSession | None, connection_id: UUID) -> ConnectionRecord:
        if session is None:
            raise ApiError(404, "connection_not_found", "Conexão não encontrada.")
        with session.lock:
            connection = session.connections.get(connection_id)
        if connection is None:
            raise ApiError(404, "connection_not_found", "Conexão não encontrada.")
        return connection

    @staticmethod
    def delete_connection(session: BrowserSession | None, connection_id: UUID) -> None:
        if session is None:
            raise ApiError(404, "connection_not_found", "Conexão não encontrada.")
        with session.lock:
            connection = session.connections.pop(connection_id, None)
        if connection is None:
            raise ApiError(404, "connection_not_found", "Conexão não encontrada.")
        with connection.lock:
            connection.password = None
