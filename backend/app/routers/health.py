"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    """Returns ok status — used by Docker healthcheck and load balancers."""
    return {"status": "ok"}
