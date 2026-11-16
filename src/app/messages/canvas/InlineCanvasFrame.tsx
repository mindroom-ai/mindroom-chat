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

/** How much a page rendered `width` pixels wide shrinks to fit a column; it never grows. */
export const inlineCanvasScale = (column: number, width: number | undefined): number =>
  width === undefined || column <= 0 ? 1 : Math.min(1, column / width);

function SizedFrame({
  doc,
  title,
  width,
  raw,
}: {
  doc: string;
  title: string;
  width?: number;
  raw: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [column, setColumn] = useState(0);
  useEffect(() => {
    // Inline pages are display-only: no submission, saved state, or error handlers.
    const resize = (event: MessageEvent) => {
      const size = readCanvasSize(event, canvasFrameWindow(frame.current));
      if (size !== undefined) setHeight(clampInlineCanvasHeight(size));
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  useEffect(() => {
    const element = box.current;
    if (width === undefined || !element) return undefined;
    setColumn(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setColumn(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  // A page with its own viewport width renders at that width and shrinks to the column, so a
  // desktop layout keeps its desktop breakpoint; the frame's box takes the shrunk height.
  const scale = inlineCanvasScale(column, width);
  return (
    // A preview is placed, not read: it starts at the left edge in every language, so its scale's
    // origin and its overflow stay on the same side.
    <div ref={box} dir="ltr" style={{ height: height * scale, overflow: 'hidden' }}>
      <iframe
        ref={frame}
        title={title}
        srcDoc={doc}
        sandbox={CANVAS_WRAPPER_SANDBOX}
        allow={CANVAS_PERMISSIONS}
        referrerPolicy="no-referrer"
        style={{
          width: width === undefined ? '100%' : width,
          height,
          display: 'block',
          border: 0,
          // A raw page is a page in a browser: its canvas is white until its own CSS says otherwise.
          background: raw ? '#fff' : undefined,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          // eslint-disable-next-line no-restricted-syntax -- the box above is dir=ltr on purpose.
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

function LoadedInlineCanvas({
  mx,
  roomId,
  action,
  libraries,
  remote,
}: {
  mx: MatrixClient;
  roomId: string;
  action: CanvasAction;
  libraries: boolean;
  remote: boolean;
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
        : buildCanvasDocument(
            html,
            colorScheme,
            theme,
            action.canvas.title,
            libraries,
            {},
            {
              inline: true,
              raw: action.canvas.raw === true,
              remote,
            }
          ),
    [html, colorScheme, theme, action.canvas.title, action.canvas.raw, libraries, remote]
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
      width={action.canvas.width}
      raw={action.canvas.raw === true}
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
      remote={config.mindroom.canvas.remoteAssets === true}
    />
  );
}
