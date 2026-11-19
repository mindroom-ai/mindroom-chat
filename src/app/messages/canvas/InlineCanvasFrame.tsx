import {
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { getMemberDisplayName } from '../../matrix/room';
import { readChatUiAction, type ChatUiAction } from '../../matrix/protocol/chatUiProtocol';
import { ThemeKind, useTheme } from '../../theme/useTheme';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import { useCanvasPage } from './useCanvasPage';
import { useCanvasSavedState } from './useCanvasSavedState';
import { useCanvasStateShare } from './useCanvasStateShare';
import { useCanvasHost } from './useCanvasHost';
import { CanvasAnswerBar } from './CanvasAnswerBar';
import { CanvasPageErrors } from './CanvasPageErrors';
import { CanvasUpdateNotice } from './CanvasUpdateNotice';
import { readCanvasTheme } from './canvasTheme';
import {
  buildCanvasDocument,
  canvasDocumentKey,
  canvasFrameWindow,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_WRAPPER_SANDBOX,
  CANVAS_PERMISSIONS,
  clampInlineCanvasHeight,
  inlineCanvasWindowHeight,
  RAW_COLOR_SCHEME,
  readCanvasSize,
} from './canvasDocument';

type CanvasAction = Extract<ChatUiAction, { action: 'show_canvas' }>;

/** How much a page rendered `width` pixels wide shrinks to fit a column; it never grows. */
export const inlineCanvasScale = (column: number, width: number | undefined): number =>
  width === undefined || column <= 0 ? 1 : Math.min(1, column / width);

/** A page that keeps escaping its frame, such as one that navigates as it loads, stops reloading. */
const MAX_ESCAPE_RELOADS = 3;

function SizedFrame({
  doc,
  title,
  width,
  raw,
  frameRef,
  onRestart,
}: {
  doc: string;
  title: string;
  width?: number;
  raw: boolean;
  /** The page's host, which reads its other messages, follows this frame. */
  frameRef?: RefObject<HTMLIFrameElement>;
  /** The page escaped and starts again; its host builds it again from what it saved since. */
  onRestart?: () => void;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const ownFrame = useRef<HTMLIFrameElement>(null);
  const frame = frameRef ?? ownFrame;
  const [reported, setReported] = useState<number>();
  const [column, setColumn] = useState(0);
  const [reloads, setReloads] = useState(0);
  const restart = useRef(onRestart);
  restart.current = onRestart;
  useEffect(() => {
    // Size and escapes only; a page's host, when it has one, reads the rest.
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.origin === 'null' &&
        event.data?.type === CANVAS_ESCAPE_MESSAGE
      ) {
        // The page tried to load something else, such as a link it was clicked on: start it again.
        setReloads((count) => count + 1);
        restart.current?.();
        return;
      }
      const size = readCanvasSize(event, canvasFrameWindow(frame.current));
      if (size !== undefined) setReported(clampInlineCanvasHeight(size));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frame]);
  // A website preview (raw, or with its own width) is laid out in a browser window of a fixed height,
  // 16:10 of its width, so its viewport never depends on its content; the box shows as much of the
  // window as the page fills and the rest scrolls inside it. A themed page's frame fits its content.
  const preview = raw || width !== undefined;
  const stopped = reloads > MAX_ESCAPE_RELOADS;
  useLayoutEffect(() => {
    const element = box.current;
    if (!preview || stopped || !element) return undefined;
    setColumn(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setColumn(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [preview, stopped]);
  if (stopped)
    return (
      <Box direction="Column" alignItems="Start" gap="100">
        <Text size="T300" role="alert">
          {t('mindroomUi.canvas.escaped')}
        </Text>
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          onClick={() => setReloads(0)}
        >
          <Text size="B300">{t('mindroomUi.canvas.reload')}</Text>
        </Button>
      </Box>
    );
  // A page with its own viewport width renders at that width and shrinks to the column, so a
  // desktop layout keeps its desktop breakpoint; the frame's box takes the shrunk height.
  const scale = inlineCanvasScale(column, width);
  const limit = inlineCanvasWindowHeight(width ?? column);
  const frameHeight = preview ? limit : reported ?? 160;
  const shown = preview ? Math.min(reported ?? limit, limit) : frameHeight;
  return (
    // A preview is placed, not read: it starts at the left edge in every language, so its scale's
    // origin and its overflow stay on the same side.
    <div ref={box} dir="ltr" style={{ height: shown * scale, overflow: 'hidden' }}>
      <iframe
        key={reloads}
        ref={frame}
        title={title}
        srcDoc={doc}
        sandbox={CANVAS_WRAPPER_SANDBOX}
        allow={CANVAS_PERMISSIONS}
        referrerPolicy="no-referrer"
        style={{
          width: width === undefined ? '100%' : width,
          height: frameHeight,
          display: 'block',
          border: 0,
          // A raw page is a page in a browser: its canvas is white until its own CSS says otherwise.
          background: raw ? '#fff' : undefined,
          colorScheme: raw ? RAW_COLOR_SCHEME : undefined,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          // eslint-disable-next-line no-restricted-syntax -- the box above is dir=ltr on purpose.
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

const useInlineCanvasTheme = () => {
  const appTheme = useTheme();
  const colorScheme = appTheme.kind === ThemeKind.Dark ? 'dark' : 'light';
  const [theme, setTheme] = useState(() => readCanvasTheme(colorScheme));
  useEffect(() => {
    // The app applies its theme in an effect, so re-read the tokens one frame later.
    const frame = requestAnimationFrame(() => setTheme(readCanvasTheme(colorScheme)));
    return () => cancelAnimationFrame(frame);
  }, [colorScheme, appTheme.id]);
  return { colorScheme, theme } as const;
};

function PageStatus({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" alignItems="Start" gap="100">
      <Text size="T300" role={failed ? 'alert' : 'status'}>
        {t(failed ? 'mindroomUi.canvas.loadFailed' : 'mindroomUi.canvas.loading')}
      </Text>
      {failed && (
        <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onRetry}>
          <Text size="B300">{t('mindroomUi.canvas.retry')}</Text>
        </Button>
      )}
    </Box>
  );
}

type InlineCanvasProps = {
  mx: MatrixClient;
  room: Room;
  action: CanvasAction;
  libraries: boolean;
  remote: boolean;
};

/** A page that only shows: no answers, saved state or error reports. */
function PassiveInlineCanvas({ mx, room, action, libraries, remote }: InlineCanvasProps) {
  const { colorScheme, theme } = useInlineCanvasTheme();
  const [attempt, setAttempt] = useState(0);
  const page = useCanvasPage(mx, room.roomId, action.revisionEventId, action.canvas, attempt);
  const html = page.status === 'ready' ? page.html : undefined;
  const doc = useMemo(
    () =>
      html === undefined
        ? undefined
        : buildCanvasDocument(
            html,
            // A raw page uses none of Chat's theme, so switching the theme leaves it as it is.
            action.canvas.raw === true ? 'light' : colorScheme,
            action.canvas.raw === true ? undefined : theme,
            action.canvas.title,
            libraries,
            {},
            {
              inline: true,
              raw: action.canvas.raw === true,
              remote,
              pinned: action.canvas.libraries,
            }
          ),
    [
      html,
      colorScheme,
      theme,
      action.canvas.title,
      action.canvas.raw,
      action.canvas.libraries,
      libraries,
      remote,
    ]
  );
  if (doc === undefined)
    return (
      <PageStatus
        failed={page.status === 'failed'}
        onRetry={() => setAttempt((count) => count + 1)}
      />
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

/**
 * The page as the panel hosts it: its answers wait for the user's Send, its inputs and saved
 * state come back whenever it starts again (every time its row scrolls back into view), its errors
 * can go to the agent, and an update waits while the user works in it.
 */
function InteractiveInlineCanvas({ mx, room, action, libraries, remote }: InlineCanvasProps) {
  const { colorScheme, theme } = useInlineCanvasTheme();
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const page = useCanvasPage(mx, room.roomId, action.revisionEventId, action.canvas, attempt);
  // The panel's key, so the panel opens where the page in the thread left off.
  const saved = useCanvasSavedState(mx, action.eventId);
  // Only the requester runs the page here, and only their copy may reach the agent.
  const shared = !!action.shareState;
  const share = useCanvasStateShare(mx, room, action.eventId, shared);
  // The page waits until its saved state is read, so it starts from it.
  const loaded = page.status === 'ready' && saved.ready ? page : undefined;
  const agentName =
    getMemberDisplayName(room, action.agentUserId) ??
    getMxIdLocalPart(action.agentUserId) ??
    action.agentUserId;
  const host = useCanvasHost({
    mx,
    room,
    canvas: {
      eventId: action.eventId,
      revisionEventId: action.revisionEventId,
      agentUserId: action.agentUserId,
      threadId: action.threadId,
      title: action.canvas.title,
      html: loaded ? loaded.html : '',
      ...(action.canvas.raw ? { raw: true as const } : {}),
      ...(action.canvas.width === undefined ? {} : { width: action.canvas.width }),
      ...(action.canvas.libraries ? { libraries: action.canvas.libraries } : {}),
      ...(loaded ? {} : { status: page.status === 'ready' ? 'loading' : page.status }),
    },
    agentName,
    colorScheme,
    theme,
    build: (shown) =>
      buildCanvasDocument(
        shown.html,
        // A raw page uses none of Chat's theme.
        shown.raw ? 'light' : shown.colorScheme,
        shown.raw ? undefined : shown.theme,
        shown.title,
        libraries,
        saved.read(),
        { inline: true, raw: shown.raw === true, remote, pinned: shown.libraries }
      ),
    buildKey: `${libraries}:${remote}:${restarts}`,
    onSaveState: (change, byUser) => {
      saved.save(change);
      // What the page saves before the user works in it is not theirs to share.
      if (byUser) share(saved.read());
    },
  });
  const { displayed } = host;
  return (
    <Box direction="Column" gap="100">
      <CanvasPageErrors host={host} room={room} agentName={agentName} />
      <CanvasUpdateNotice host={host} agentName={agentName} inline />
      {/* Above the page, so the user reads it before they type anything the room can read. */}
      {shared && (
        <Text size="T200" priority="300" data-canvas-shared>
          {t('mindroomUi.canvas.sharedNotice', { agent: agentName })}
        </Text>
      )}
      {displayed.status ? (
        <PageStatus
          failed={displayed.status === 'failed'}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      ) : (
        <SizedFrame
          // A restart builds a new document but keeps the frame's count of escapes.
          key={displayed.revisionEventId}
          frameRef={host.frameRef}
          onRestart={() => setRestarts((count) => count + 1)}
          doc={host.doc}
          title={displayed.title}
          width={displayed.width}
          raw={displayed.raw === true}
        />
      )}
      <CanvasAnswerBar host={host} room={room} agentName={agentName} shared={false} inline />
    </Box>
  );
}

/**
 * The latest accepted inline canvas. It runs only for the member who asked for it; another member
 * opens it with the notice's button, so a page made for someone else never runs (or loads remote
 * assets) on its own. On a read-only row it only shows; while the room's panel shows the same
 * canvas, the thread names it instead, so one window never runs two copies of one page.
 */
export function InlineCanvasFrame({
  event,
  readOnly = false,
}: {
  event: MatrixEvent;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const config = useClientConfig();
  const mx = useMatrixClient();
  const openCanvasId = useContext(ChatUiActionContext)?.openCanvasId;
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
  if (action.requesterId !== mx.getSafeUserId()) return null;
  const props = {
    mx,
    room,
    action,
    libraries: config.mindroom.canvas.libraries === true,
    remote: config.mindroom.canvas.remoteAssets === true,
  };
  if (readOnly) return <PassiveInlineCanvas key={action.eventId} {...props} />;
  if (openCanvasId === action.eventId)
    return (
      <Text size="T300" priority="300" role="status" data-canvas-in-panel>
        {t('mindroomUi.canvas.shownInPanel')}
      </Text>
    );
  // One host per canvas: its saved and shared state hooks rely on the canvas never changing under them.
  return <InteractiveInlineCanvas key={action.eventId} {...props} />;
}
