import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { readChatUiAction, type ChatUiAction } from '../../matrix/protocol/chatUiProtocol';
import { ThemeKind, useTheme } from '../../theme/useTheme';
import { useCanvasPage } from './useCanvasPage';
import { readCanvasTheme } from './canvasTheme';
import {
  buildCanvasDocument,
  canvasDocumentKey,
  canvasFrameWindow,
  CANVAS_WRAPPER_SANDBOX,
  CANVAS_PERMISSIONS,
  clampInlineCanvasHeight,
  readCanvasSize,
} from './canvasDocument';

type CanvasAction = Extract<ChatUiAction, { action: 'show_canvas' }>;

function SizedFrame({ doc, title }: { doc: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  useEffect(() => {
    // Inline pages are display-only: no submission, saved state, or error handlers.
    const resize = (event: MessageEvent) => {
      const size = readCanvasSize(event, canvasFrameWindow(frame.current));
      if (size !== undefined) setHeight(clampInlineCanvasHeight(size));
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={doc}
      sandbox={CANVAS_WRAPPER_SANDBOX}
      allow={CANVAS_PERMISSIONS}
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, display: 'block', border: 0 }}
    />
  );
}

function LoadedInlineCanvas({
  mx,
  roomId,
  action,
  libraries,
}: {
  mx: MatrixClient;
  roomId: string;
  action: CanvasAction;
  libraries: boolean;
}) {
  const { t } = useTranslation();
  const appTheme = useTheme();
  const colorScheme = appTheme.kind === ThemeKind.Dark ? 'dark' : 'light';
  const [theme, setTheme] = useState(() => readCanvasTheme(colorScheme));
  useEffect(() => {
    // The app applies its theme in an effect, so re-read the tokens one frame later.
    const frame = requestAnimationFrame(() => setTheme(readCanvasTheme(colorScheme)));
    return () => cancelAnimationFrame(frame);
  }, [colorScheme, appTheme.id]);
  const [attempt, setAttempt] = useState(0);
  const page = useCanvasPage(mx, roomId, action.revisionEventId, action.canvas, attempt);
  const html = page.status === 'ready' ? page.html : undefined;
  const doc = useMemo(
    () =>
      html === undefined
        ? undefined
        : buildCanvasDocument(html, colorScheme, theme, action.canvas.title, libraries, {}, true),
    [html, colorScheme, theme, action.canvas.title, libraries]
  );
  if (doc === undefined)
    return (
      <Box direction="Column" alignItems="Start" gap="100">
        <Text size="T300" role={page.status === 'failed' ? 'alert' : 'status'}>
          {t(
            page.status === 'failed' ? 'mindroomUi.canvas.loadFailed' : 'mindroomUi.canvas.loading'
          )}
        </Text>
        {page.status === 'failed' && (
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => setAttempt((count) => count + 1)}
          >
            <Text size="B300">{t('mindroomUi.canvas.retry')}</Text>
          </Button>
        )}
      </Box>
    );
  return (
    <SizedFrame
      key={`${action.revisionEventId}:${canvasDocumentKey(doc)}`}
      doc={doc}
      title={action.canvas.title}
    />
  );
}

/** The latest accepted inline canvas, with no panel side effects or saved state. */
export function InlineCanvasFrame({ event }: { event: MatrixEvent }) {
  const config = useClientConfig();
  const mx = useMatrixClient();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const redacted = () => queueMicrotask(refresh);
    event.on(MatrixEventEvent.Replaced, refresh);
    event.on(MatrixEventEvent.BeforeRedaction, redacted);
    return () => {
      event.off(MatrixEventEvent.Replaced, refresh);
      event.off(MatrixEventEvent.BeforeRedaction, redacted);
    };
  }, [event]);
  if (config.mindroom?.canvas?.enabled !== true) return null;
  const room = mx.getRoom(event.getRoomId());
  if (!room) return null;
  const action = readChatUiAction(event, mx.getSafeUserId(), room);
  if (action?.action !== 'show_canvas' || !action.inline) return null;
  return (
    <LoadedInlineCanvas
      key={action.eventId}
      mx={mx}
      roomId={room.roomId}
      action={action}
      libraries={config.mindroom.canvas.libraries === true}
    />
  );
}
