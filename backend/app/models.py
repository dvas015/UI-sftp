from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


ConnectionStatus = Literal["connected", "disconnected"]
FileKind = Literal["folder", "code", "image", "video", "audio", "archive", "file"]


class ConnectionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, max_length=48)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=255)
    password: SecretStr

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("name must not be blank")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value():
            raise ValueError("password must not be empty")
        return value


class ConnectionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, max_length=48)
    host: str | None = Field(default=None, min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, min_length=1, max_length=255)
    password: SecretStr | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("name must not be blank")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value():
            raise ValueError("password must not be empty")
        return value


class ReconnectRequest(BaseModel):
    password: SecretStr

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value():
            raise ValueError("password must not be empty")
        return value


class ConnectionPublic(BaseModel):
    id: UUID
    name: str
    host: str
    port: int
    username: str
    initial_path: str
    status: ConnectionStatus
    last_verified_at: datetime | None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


class RemoteFile(BaseModel):
    name: str
    path: str
    type: str
    size: int | None
    modified_at: datetime | None
    permissions: str
    kind: FileKind


class DirectoryListing(BaseModel):
    path: str
    items: list[RemoteFile]


class PathRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class RenameEntryRequest(PathRequest):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def validate_entry_name(cls, value: str) -> str:
        if value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError("name must be a single path component")
        return value


class MoveEntryRequest(PathRequest):
    destination: str = Field(min_length=1, max_length=4096)


class PermissionsUpdateRequest(PathRequest):
    mode: str = Field(pattern=r"^[0-7]{3,4}$")


class EntryOperationResult(BaseModel):
    path: str


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
