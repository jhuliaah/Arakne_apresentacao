"""Pydantic schemas for authentication."""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Request body for POST /login."""

    identificador: str = Field(..., description="Identificador gerado no cadastro")
    pin: str = Field(..., min_length=4, max_length=32)


class TokenResponse(BaseModel):
    """Response for POST /login — opaque session token."""

    token: str
    token_type: str = "bearer"
    identificador: str
