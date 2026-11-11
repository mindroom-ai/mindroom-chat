"""The origin plugin's one page, on each of its own hosts (e2e/plugins/agent-plugin-origin.spec.ts)."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/")
async def page(request: Request) -> HTMLResponse:
    """Name the host that served the page; MindRoom routes only this plugin's hosts here, all DNS labels."""
    return HTMLResponse(f"<!doctype html><title>Origin page</title><p>Served on {request.url.hostname}</p>")
