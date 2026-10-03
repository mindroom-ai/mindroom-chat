import React, { useEffect, useReducer } from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { ThemeKind, useTheme } from '../../hooks/useTheme';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import { readChatUiAction } from '../ui-actions/chatUiProtocol';
import { CanvasPanel } from './CanvasPanel';

type RoomCanvasPanelProps = {
  mx: MatrixClient;
  room: Room;
  event: MatrixEvent;
  onClose: () => void;
};

/** Resolve the open request (and its latest same-sender edit) into the sandboxed panel. */
export function RoomCanvasPanel({ mx, room, event, onClose }: RoomCanvasPanelProps) {
  const theme = useTheme();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // The SDK announces a redaction before applying it, so re-read afterwards.
    const afterRedaction = () => queueMicrotask(refresh);
    event.on(MatrixEventEvent.Replaced, refresh);
    event.on(MatrixEventEvent.BeforeRedaction, afterRedaction);
    return () => {
      event.off(MatrixEventEvent.Replaced, refresh);
      event.off(MatrixEventEvent.BeforeRedaction, afterRedaction);
    };
  }, [event]);

  const action = readChatUiAction(event, mx.getSafeUserId(), room);
  const valid = action?.action === 'show_canvas';
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  if (action?.action !== 'show_canvas') return null;

  const agentName =
    getMemberDisplayName(room, action.agentUserId) ??
    getMxIdLocalPart(action.agentUserId) ??
    action.agentUserId;
  return (
    <CanvasPanel
      key={action.eventId}
      mx={mx}
      roomId={room.roomId}
      canvas={{
        eventId: action.eventId,
        revisionEventId: event.replacingEventId() ?? action.eventId,
        agentUserId: action.agentUserId,
        threadId: action.threadId,
        title: action.canvas.title,
        html: action.canvas.html,
      }}
      agentName={agentName}
      colorScheme={theme.kind === ThemeKind.Dark ? 'dark' : 'light'}
      onClose={onClose}
    />
  );
}
