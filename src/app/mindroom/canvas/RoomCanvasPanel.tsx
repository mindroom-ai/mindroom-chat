import React, { useEffect, useMemo, useReducer } from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { ThemeKind, useTheme } from '../../hooks/useTheme';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import { ResizablePanel } from '../sidebar/ResizablePanel';
import { readChatUiAction, type ChatUiCanvas } from '../ui-actions/chatUiProtocol';
import { CanvasPanel } from './CanvasPanel';
import { readCanvasTheme } from './canvasTheme';
import { useCanvasPage } from './useCanvasPage';

type RoomCanvasPanelProps = {
  mx: MatrixClient;
  room: Room;
  event: MatrixEvent;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

type ShowCanvas = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  canvas: ChatUiCanvas;
};

// Dashboards need room: the panel may grow wide while the conversation keeps a usable column.
const CANVAS_DEFAULT_WIDTH = 560;
const CANVAS_MAX_WIDTH = 1600;
const CONVERSATION_MIN_WIDTH = 360;

function LoadedCanvasPanel({
  mx,
  room,
  action,
  onClose,
  expanded,
  onToggleExpanded,
}: Omit<RoomCanvasPanelProps, 'event'> & { action: ShowCanvas }) {
  const appTheme = useTheme();
  const colorScheme = appTheme.kind === ThemeKind.Dark ? 'dark' : 'light';
  // The canvas copies the app theme's resolved colors, re-read whenever the app theme changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => readCanvasTheme(colorScheme), [colorScheme, appTheme.id]);
  const page = useCanvasPage(mx, room.roomId, action.revisionEventId, action.canvas);
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const agentName =
    getMemberDisplayName(room, action.agentUserId) ??
    getMxIdLocalPart(action.agentUserId) ??
    action.agentUserId;
  const panel = (
    <CanvasPanel
      mx={mx}
      roomId={room.roomId}
      canvas={{
        eventId: action.eventId,
        revisionEventId: action.revisionEventId,
        agentUserId: action.agentUserId,
        threadId: action.threadId,
        title: action.canvas.title,
        html: page.status === 'ready' ? page.html : '',
        ...(page.status === 'ready' ? {} : { status: page.status }),
      }}
      agentName={agentName}
      colorScheme={colorScheme}
      theme={theme}
      onClose={onClose}
      expanded={!mobile && expanded}
      onToggleExpanded={mobile ? undefined : onToggleExpanded}
    />
  );
  // Phones show the canvas full screen; desktops get a resizable column.
  if (mobile) return panel;
  return (
    <ResizablePanel
      side="end"
      storageKey={`mindroom.canvas.width:${mx.getSafeUserId()}`}
      defaultWidth={CANVAS_DEFAULT_WIDTH}
      minContentWidth={CONVERSATION_MIN_WIDTH}
      maxPanelWidth={CANVAS_MAX_WIDTH}
      fullWidth={expanded}
      resizeLabel="Resize canvas"
      collapseLabel="Close canvas"
      onCollapse={onClose}
      testId="resizable-canvas-panel"
    >
      {panel}
    </ResizablePanel>
  );
}

/** Resolve the open request (and its latest same-sender edit) into the sandboxed panel. */
export function RoomCanvasPanel({ event, ...props }: RoomCanvasPanelProps) {
  const { mx, room, onClose } = props;
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
  return <LoadedCanvasPanel key={action.eventId} {...props} action={action} />;
}
