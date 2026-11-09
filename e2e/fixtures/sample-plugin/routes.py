"""The sample plugin directory's routes, which the example client plugin's panel calls (e2e/plugins/mindroom-server.spec.ts)."""

import base64
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket
from starlette.datastructures import UploadFile

from mindroom.plugin_http import ClientUser, client_stream, require_room_member

router = APIRouter()

# A green square, 16 by 16 pixels.
_SQUARE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mPQqzUiCTGMahjVMHw1AAB63t0BySdljwAAAABJRU5ErkJggg==",
)


@router.get("/rooms/{room_id}/hello")
async def hello(user: Annotated[ClientUser, Depends(require_room_member)]) -> dict[str, str]:
    """Greet the signed-in member of the room by their Matrix user ID."""
    return {"hello": user.user_id}


@router.get("/rooms/{room_id}/square.png", dependencies=[Depends(require_room_member)])
async def square() -> Response:
    """Answer an image, not JSON, to the signed-in member of the room."""
    return Response(_SQUARE_PNG, media_type="image/png")


@router.post("/rooms/{room_id}/upload", dependencies=[Depends(require_room_member)])
async def upload(request: Request) -> dict[str, int]:
    """Answer the size in bytes of the multipart ``file`` the signed-in member of the room sent.

    The body is read here, after the room check, rather than as a ``File`` parameter that FastAPI reads first.
    """
    async with request.form() as form:
        sent = form.get("file")
        if not isinstance(sent, UploadFile):
            raise HTTPException(422, "Send the upload as the multipart field file.")
        return {"size": len(await sent.read())}


@router.websocket("/rooms/{room_id}/echo")
async def echo(websocket: WebSocket, room_id: str) -> None:
    """Send each text back to the signed-in member of the room, after their user ID."""
    async with client_stream(websocket, room_id) as user:
        async for text in websocket.iter_text():
            await websocket.send_text(f"{user.user_id}: {text}")
