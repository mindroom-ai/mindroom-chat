"""The sample plugin directory's routes, which the example client plugin's panel calls (e2e/plugins/mindroom-server.spec.ts)."""

from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket

from mindroom.plugin_http import ClientUser, client_stream, require_room_member

router = APIRouter()


@router.get("/rooms/{room_id}/hello")
async def hello(user: Annotated[ClientUser, Depends(require_room_member)]) -> dict[str, str]:
    """Greet the signed-in member of the room by their Matrix user ID."""
    return {"hello": user.user_id}


@router.websocket("/rooms/{room_id}/echo")
async def echo(websocket: WebSocket, room_id: str) -> None:
    """Send each text back to the signed-in member of the room, after their user ID."""
    async with client_stream(websocket, room_id) as user:
        async for text in websocket.iter_text():
            await websocket.send_text(f"{user.user_id}: {text}")
