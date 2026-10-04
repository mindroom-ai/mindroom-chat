import React, { useEffect, useReducer, useState } from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const appTheme = useTheme();
  const colorScheme = appTheme.kind === ThemeKind.Dark ? 'dark' : 'light';
  const [theme, setTheme] = useState(() => readCanvasTheme(colorScheme));
  useEffect(() => {
    // The theme manager applies the new theme in its own effect, after this one; read a frame later.
    const frame = requestAnimationFrame(() => setTheme(readCanvasTheme(colorScheme)));
    return () => cancelAnimationFrame(frame);
  }, [colorScheme, appTheme.id]);
  const [attempt, setAttempt] = useState(0);
  const page = useCanvasPage(mx, room.roomId, action.revisionEventId, action.canvas, attempt);
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
      onRetry={() => setAttempt((count) => count + 1)}
      expanded={!mobile && expanded}
      onToggleExpanded={mobile ? undefined : onToggleExpanded}
    />
  );
  // One tree for every screen size, so crossing a breakpoint never reloads the page:
  // phones show the panel full screen (no box of its own), wider screens a resizable column.
  return (
    <ResizablePanel
      side="end"
      storageKey={`mindroom.canvas.width:${mx.getSafeUserId()}`}
      defaultWidth={CANVAS_DEFAULT_WIDTH}
      minContentWidth={CONVERSATION_MIN_WIDTH}
      maxPanelWidth={CANVAS_MAX_WIDTH}
      fullWidth={expanded}
      passthrough={mobile}
      resizeLabel={t('mindroomUi.canvas.resize')}
      collapseLabel={t('mindroomUi.canvas.close')}
      onCollapse={onClose}
      testId="resizable-canvas-panel"
    >
      {panel}
    </ResizablePanel>
  );
}

/** When the request's applied edit was sent, or -1 without an edit from the request's sender. */
const editTime = (request: MatrixEvent): number => {
  const edit = request.replacingEvent();
  return edit && edit.getSender() === request.getSender() ? edit.getTs() : -1;
};

/** Resolve the open request (and its latest same-sender edit) into the sandboxed panel. */
export function RoomCanvasPanel({ event, ...props }: RoomCanvasPanelProps) {
  const { mx, room, onClose } = props;
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  // The timeline can hold another copy of the request (a cached thread page, a reset timeline), so
  // an edit may land on a different object. A copy is followed only when its edit from the original
  // sender is newer than the shown one, so notification order can never roll the page back.
  const [request, setRequest] = useState(event);
  useEffect(() => setRequest(event), [event]);
  useEffect(() => {
    const eventId = event.getId();
    const followCopy = (replaced: MatrixEvent) => {
      if (replaced.getId() !== eventId) return;
      setRequest((current) => (editTime(replaced) > editTime(current) ? replaced : current));
    };
    mx.on(MatrixEventEvent.Replaced, followCopy);
    return () => {
      mx.off(MatrixEventEvent.Replaced, followCopy);
    };
  }, [mx, event]);
  useEffect(() => {
    // The SDK announces a redaction before applying it, so re-read afterwards.
    const afterRedaction = () => queueMicrotask(refresh);
    request.on(MatrixEventEvent.Replaced, refresh);
    request.on(MatrixEventEvent.BeforeRedaction, afterRedaction);
    return () => {
      request.off(MatrixEventEvent.Replaced, refresh);
      request.off(MatrixEventEvent.BeforeRedaction, afterRedaction);
    };
  }, [request]);

  const action = readChatUiAction(request, mx.getSafeUserId(), room);
  const valid = action?.action === 'show_canvas';
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  if (action?.action !== 'show_canvas') return null;
  return <LoadedCanvasPanel key={action.eventId} {...props} action={action} />;
}
