from dataclasses import dataclass
from threading import RLock
from time import monotonic
from typing import Literal
from uuid import UUID


DownloadStatus = Literal["preparing", "downloading", "completed", "failed"]


@dataclass(slots=True)
class DownloadProgress:
    id: UUID
    owner_session_id: str
    status: DownloadStatus = "preparing"
    bytes_transferred: int = 0
    total_bytes: int | None = None
    error: str | None = None
    updated_at: float = 0.0

    def public(self) -> dict[str, object]:
        return {
            "id": str(self.id),
            "status": self.status,
            "bytes_transferred": self.bytes_transferred,
            "total_bytes": self.total_bytes,
            "error": self.error,
        }


class DownloadTracker:
    """Process-local progress registry for native browser downloads."""

    def __init__(self, completed_ttl: float = 600.0, active_ttl: float = 21_600.0) -> None:
        self.completed_ttl = completed_ttl
        self.active_ttl = active_ttl
        self._downloads: dict[UUID, DownloadProgress] = {}
        self._lock = RLock()

    def register(self, transfer_id: UUID, owner_session_id: str) -> bool:
        with self._lock:
            self._discard_expired()
            if transfer_id in self._downloads:
                return False
            self._downloads[transfer_id] = DownloadProgress(
                id=transfer_id,
                owner_session_id=owner_session_id,
                updated_at=monotonic(),
            )
            return True

    def start(self, transfer_id: UUID, total_bytes: int) -> None:
        with self._lock:
            progress = self._downloads.get(transfer_id)
            if progress is None:
                return
            progress.status = "downloading"
            progress.total_bytes = total_bytes
            progress.updated_at = monotonic()

    def advance(self, transfer_id: UUID, amount: int) -> None:
        with self._lock:
            progress = self._downloads.get(transfer_id)
            if progress is None or progress.status != "downloading":
                return
            progress.bytes_transferred += amount
            progress.updated_at = monotonic()

    def complete(self, transfer_id: UUID) -> None:
        with self._lock:
            progress = self._downloads.get(transfer_id)
            if progress is None:
                return
            progress.status = "completed"
            if progress.total_bytes is not None:
                progress.bytes_transferred = progress.total_bytes
            progress.updated_at = monotonic()

    def fail(self, transfer_id: UUID, message: str) -> None:
        with self._lock:
            progress = self._downloads.get(transfer_id)
            if progress is None or progress.status == "completed":
                return
            progress.status = "failed"
            progress.error = message
            progress.updated_at = monotonic()

    def fail_if_active(self, transfer_id: UUID, message: str) -> None:
        with self._lock:
            progress = self._downloads.get(transfer_id)
            if progress is None or progress.status not in {"preparing", "downloading"}:
                return
            progress.status = "failed"
            progress.error = message
            progress.updated_at = monotonic()

    def get(self, transfer_id: UUID, owner_session_id: str | None) -> dict[str, object] | None:
        with self._lock:
            self._discard_expired()
            progress = self._downloads.get(transfer_id)
            if progress is None or not owner_session_id or progress.owner_session_id != owner_session_id:
                return None
            return progress.public()

    def _discard_expired(self) -> None:
        now = monotonic()
        expired = [
            transfer_id
            for transfer_id, progress in self._downloads.items()
            if now - progress.updated_at > (
                self.completed_ttl if progress.status in {"completed", "failed"} else self.active_ttl
            )
        ]
        for transfer_id in expired:
            self._downloads.pop(transfer_id, None)
