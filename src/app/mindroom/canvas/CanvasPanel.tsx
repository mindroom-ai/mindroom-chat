import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventStatus, MatrixEventEvent, type MatrixClient } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, type IconSrc, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  buildCanvasDocument,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_PERMISSIONS,
  CANVAS_WRAPPER_SANDBOX,
  canvasFrameWindow,
  type CanvasColorScheme,
} from './canvasDocument';
import {
  buildCanvasResponseContent,
  readCanvasSubmission,
  type CanvasSubmission,
} from './canvasMessages';
import type { CanvasTheme } from './canvasTheme';
import * as css from './CanvasPanel.css';

/** A new snapshot cannot be sent by a click that was already on its way. */
export const CANVAS_SEND_ARM_DELAY_MS = 500;

export type CanvasView = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  title: string;
  html: string;
  /** An uploaded page that is still downloading, or could not be loaded. */
  status?: 'loading' | 'failed';
};

export type CanvasPanelProps = {
  mx: MatrixClient;
  roomId: string;
  canvas: CanvasView;
  agentName: string;
  colorScheme: CanvasColorScheme;
  theme: CanvasTheme;
  onClose: () => void;
  onRetry?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
};

const ExpandIcon: IconSrc = () => (
  <path
    d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
const ShrinkIcon: IconSrc = () => (
  <path
    d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

type Staged = {
  submission: CanvasSubmission;
  txnId: string;
  armed: boolean;
};

// Sending and failed states name their answer's transaction, so a late result of an earlier
// answer cannot overwrite what the panel shows for a newer one.
type SendState =
  | { status: 'idle' }
  | { status: 'sending'; label: string; txnId: string }
  | { status: 'sent'; label: string }
  | { status: 'failed'; label: string; txnId: string };

/** Hash a document so a changed canvas remounts its frame and drops stale script state. */
const documentKey = (doc: string): string => {
  let hash = 5381;
  for (let index = 0; index < doc.length; index += 1) {
    hash = (hash * 33) ^ doc.charCodeAt(index);
  }
  return `${doc.length}:${hash >>> 0}`;
};

const formatData = (data: unknown): string => JSON.stringify(data, null, 2) ?? 'null';

const STAGE_INTERVAL_MS = 100;

type Displayed = CanvasView & { colorScheme: CanvasColorScheme; theme: CanvasTheme };

const revisionKey = (canvas: CanvasView, htmlKey: string) =>
  `${canvas.revisionEventId}\n${canvas.status ?? 'ready'}\n${canvas.title}\n${htmlKey}`;

export function CanvasPanel({
  mx,
  roomId,
  canvas,
  agentName,
  colorScheme,
  theme,
  onClose,
  onRetry,
  expanded = false,
  onToggleExpanded,
}: CanvasPanelProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The theme is fixed when a revision is shown, so switching themes cannot discard unsent work.
  const [displayed, setDisplayed] = useState<Displayed>(() => ({
    ...canvas,
    colorScheme,
    theme,
  }));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const doc = useMemo(
    () =>
      buildCanvasDocument(displayed.html, displayed.colorScheme, displayed.theme, displayed.title),
    [displayed.html, displayed.colorScheme, displayed.theme, displayed.title]
  );
  const [reloads, setReloads] = useState(0);
  const docKey = useMemo(() => documentKey(doc), [doc]);
  const frameKey = `${displayed.revisionEventId}:${docKey}:${reloads}`;
  const [escapedFrame, setEscapedFrame] = useState<string>();
  const [staged, setStaged] = useState<Staged>();
  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const loads = useRef({ frameKey, count: 0 });
  const currentFrameKey = useRef(frameKey);
  currentFrameKey.current = frameKey;
  // Whether the frame may hold work the user has not sent since it loaded or since their last send.
  const touched = useRef(false);
  // The answer this revision's panel last sent; another answer's late result cannot mark the frame.
  const activeTxnId = useRef<string>();
  // An answer on its way keeps its snapshot, so a failure still offers Send and Discard.
  const inFlightTxnId = useRef<string>();
  const lastStageAt = useRef(0);
  const latest = useRef({ canvas, colorScheme, theme });
  latest.current = { canvas, colorScheme, theme };
  // Pages can be megabytes, so revisions compare by a hash of their HTML.
  const incomingHtmlKey = useMemo(() => documentKey(canvas.html), [canvas.html]);
  const displayedHtmlKey = useMemo(() => documentKey(displayed.html), [displayed.html]);
  const handledRevision = useRef(revisionKey(canvas, incomingHtmlKey));

  useEffect(() => {
    touched.current = false;
    activeTxnId.current = undefined;
    inFlightTxnId.current = undefined;
    lastStageAt.current = 0;
    setStaged(undefined);
    setSend({ status: 'idle' });
    setUpdateAvailable(false);
  }, [frameKey]);

  // An update loads at once unless it would discard work the user has not sent.
  const incomingRevision = revisionKey(canvas, incomingHtmlKey);
  const displayedRevision = revisionKey(displayed, displayedHtmlKey);
  const displayedRevisionId = displayed.revisionEventId;
  const displayedPending = !!displayed.status;
  useEffect(() => {
    if (incomingRevision === displayedRevision) {
      handledRevision.current = incomingRevision;
      setUpdateAvailable(false);
      return;
    }
    // Each revision is decided once, so a later re-render cannot drop a newer staged answer.
    if (handledRevision.current === incomingRevision) return;
    handledRevision.current = incomingRevision;
    // A page that finished downloading belongs to the revision already shown.
    const sameRevisionLoaded =
      latest.current.canvas.revisionEventId === displayedRevisionId && displayedPending;
    if (sameRevisionLoaded || (!touched.current && document.activeElement !== frameRef.current)) {
      setDisplayed({
        ...latest.current.canvas,
        colorScheme: latest.current.colorScheme,
        theme: latest.current.theme,
      });
    } else {
      setStaged((current) =>
        current && current.txnId === inFlightTxnId.current ? current : undefined
      );
      // A failed answer has no Send button once its snapshot is gone; the timeline keeps its retry.
      setSend((current) => (current.status === 'failed' ? { status: 'idle' } : current));
      setUpdateAvailable(true);
    }
  }, [incomingRevision, displayedRevision, displayedRevisionId, displayedPending]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement === frameRef.current) touched.current = true;
    };
    const handleMessage = (event: MessageEvent) => {
      const wrapper = frameRef.current?.contentWindow;
      if (
        wrapper &&
        event.source === wrapper &&
        event.origin === 'null' &&
        event.data?.type === CANVAS_ESCAPE_MESSAGE
      ) {
        // The wrapper reports that the canvas frame tried to load something else.
        setEscapedFrame(currentFrameKey.current);
        return;
      }
      const frame = canvasFrameWindow(frameRef.current);
      if (!frame || event.source !== frame) return;
      const now = Date.now();
      // Bound bridge traffic before parsing; a canvas cannot flood the host with snapshots.
      if (now - lastStageAt.current < STAGE_INTERVAL_MS) return;
      lastStageAt.current = now;
      const submission = readCanvasSubmission(event, frame);
      if (!submission) return;
      touched.current = true;
      // A pending snapshot stays exactly what the user is reviewing until they send or discard
      // it, so a canvas cannot swap the payload under the user's click.
      setStaged((current) => current ?? { submission, txnId: mx.makeTxnId(), armed: false });
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('message', handleMessage);
    };
  }, [mx]);

  const stagedTxnId = staged?.txnId;
  useEffect(() => {
    if (!stagedTxnId) return undefined;
    const timer = window.setTimeout(
      () =>
        setStaged((current) =>
          current?.txnId === stagedTxnId ? { ...current, armed: true } : current
        ),
      CANVAS_SEND_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [stagedTxnId]);

  // Report only on the answer the panel shows; an earlier answer's late result changes nothing here.
  const settle = useCallback(
    (txnId: string, outcome: 'sending' | 'sent' | 'failed' | 'cancelled') => {
      setSend((current) => {
        if (
          (current.status !== 'sending' && current.status !== 'failed') ||
          current.txnId !== txnId
        ) {
          return current;
        }
        if (outcome === 'sending') return { status: 'sending', label: current.label, txnId };
        if (outcome === 'sent') return { status: 'sent', label: current.label };
        if (outcome === 'failed') return { status: 'failed', label: current.label, txnId };
        return { status: 'idle' };
      });
      if (outcome !== 'sending' && inFlightTxnId.current === txnId)
        inFlightTxnId.current = undefined;
      if (outcome === 'sending') inFlightTxnId.current = txnId;
      if (outcome === 'sent' || outcome === 'cancelled') {
        setStaged((current) => (current?.txnId === txnId ? undefined : current));
      }
      // A failed answer is still unsent work in this frame.
      if (outcome === 'failed' && activeTxnId.current === txnId) touched.current = true;
    },
    []
  );

  // Follow the answer's local echo through failures and retries, which the timeline can also start.
  const followedTxnId =
    send.status === 'sending' || send.status === 'failed' ? send.txnId : undefined;
  useEffect(() => {
    if (!followedTxnId) return undefined;
    const echo = mx.getRoom(roomId)?.getEventForTxnId(followedTxnId);
    if (!echo) return undefined;
    const follow = () => {
      if (echo.status === EventStatus.NOT_SENT) settle(followedTxnId, 'failed');
      else if (echo.status === EventStatus.CANCELLED) settle(followedTxnId, 'cancelled');
      else if (echo.status === null || echo.status === EventStatus.SENT) {
        settle(followedTxnId, 'sent');
      } else settle(followedTxnId, 'sending');
    };
    follow();
    echo.on(MatrixEventEvent.Status, follow);
    return () => {
      echo.off(MatrixEventEvent.Status, follow);
    };
  }, [mx, roomId, followedTxnId, settle]);

  const handleSend = useCallback(async () => {
    if (!staged?.armed || send.status === 'sending') return;
    const { submission, txnId } = staged;
    const label = submission.label ?? t('mindroomUi.canvas.unlabeled');
    const room = mx.getRoom(roomId);
    const echo = room?.getEventForTxnId(txnId);
    activeTxnId.current = txnId;
    if (echo && echo.status !== EventStatus.NOT_SENT) {
      // The timeline's own Retry or Discard already took over this answer; show where it is.
      if (echo.status === EventStatus.CANCELLED) {
        setStaged(undefined);
        setSend({ status: 'idle' });
      } else if (echo.status === null || echo.status === EventStatus.SENT) {
        setStaged(undefined);
        setSend({ status: 'sent', label });
      } else {
        setSend({ status: 'sending', label, txnId });
        inFlightTxnId.current = txnId;
      }
      return;
    }
    setSend({ status: 'sending', label, txnId });
    inFlightTxnId.current = txnId;
    // Work in the frame during the send marks it again.
    touched.current = false;
    const content = buildCanvasResponseContent(
      {
        eventId: displayed.eventId,
        revisionEventId: displayed.revisionEventId,
        agentUserId: displayed.agentUserId,
        agentName,
        threadId: displayed.threadId,
      },
      submission
    );
    try {
      if (room && echo) {
        // A retry resends the SDK's failed local echo, keeping its transaction ID.
        await mx.resendEvent(echo, room);
      } else {
        // The relation travels in the content.
        await mx.sendMessage(roomId, content as never, txnId);
      }
      settle(txnId, 'sent');
    } catch {
      settle(txnId, 'failed');
    }
  }, [agentName, displayed, mx, roomId, send.status, settle, staged, t]);

  const handleDiscard = useCallback(() => {
    const failedEcho = staged && mx.getRoom(roomId)?.getEventForTxnId(staged.txnId);
    if (failedEcho?.status === EventStatus.NOT_SENT) mx.cancelPendingEvent(failedEcho);
    setStaged(undefined);
    setSend((current) => (current.status === 'failed' ? { status: 'idle' } : current));
  }, [mx, roomId, staged]);

  const handleLoad = useCallback(() => {
    if (loads.current.frameKey !== frameKey) loads.current = { frameKey, count: 0 };
    loads.current.count += 1;
    // The wrapper's document is inline and nothing inside may navigate it, so a later load is an escape.
    if (loads.current.count > 1) setEscapedFrame(frameKey);
  }, [frameKey]);

  const escaped = escapedFrame === frameKey;

  return (
    <aside className={css.Panel} aria-label={t('mindroomUi.canvas.panelLabel')}>
      <div className={css.Header}>
        <Box alignItems="Center" gap="200">
          <Icon size="300" src={Icons.Category} />
          <div className={css.Title}>
            <Text size="H4" truncate>
              {displayed.title}
            </Text>
            <Text size="T200" priority="300" truncate>
              {t('mindroomUi.canvas.fromAgent', { agent: agentName })}
            </Text>
          </div>
        </Box>
        <Box alignItems="Center" gap="100">
          {onToggleExpanded && (
            <IconButton
              onClick={onToggleExpanded}
              aria-label={t('mindroomUi.canvas.expand')}
              aria-pressed={expanded}
              size="300"
            >
              <Icon size="300" src={expanded ? ShrinkIcon : ExpandIcon} />
            </IconButton>
          )}
          <IconButton onClick={onClose} aria-label={t('mindroomUi.canvas.close')} size="300">
            <Icon size="300" src={Icons.Cross} />
          </IconButton>
        </Box>
      </div>

      {updateAvailable && (
        <div className={css.Notice} role="status">
          <Text size="T300">{t('mindroomUi.canvas.updated', { agent: agentName })}</Text>
          <Button
            size="300"
            variant="Secondary"
            onClick={() => setDisplayed({ ...canvas, colorScheme, theme })}
          >
            <Text size="B300">{t('mindroomUi.canvas.loadUpdate')}</Text>
          </Button>
        </div>
      )}

      {displayed.status && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text
            className={displayed.status === 'failed' ? css.Error : undefined}
            size="T300"
            role={displayed.status === 'failed' ? 'alert' : 'status'}
          >
            {displayed.status === 'loading'
              ? t('mindroomUi.canvas.loading')
              : t('mindroomUi.canvas.loadFailed')}
          </Text>
          {displayed.status === 'failed' && onRetry && (
            <Button size="300" variant="Secondary" onClick={onRetry}>
              <Text size="B300">{t('mindroomUi.canvas.retry')}</Text>
            </Button>
          )}
        </Box>
      )}
      {!displayed.status && escaped && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text className={css.Error} size="T300" role="alert">
            {t('mindroomUi.canvas.escaped')}
          </Text>
          <Button
            size="300"
            variant="Secondary"
            data-canvas-reload
            onClick={() => setReloads((count) => count + 1)}
          >
            <Text size="B300">{t('mindroomUi.canvas.reload')}</Text>
          </Button>
        </Box>
      )}
      {!displayed.status && !escaped && (
        <iframe
          key={frameKey}
          ref={frameRef}
          className={css.Frame}
          title={displayed.title}
          sandbox={CANVAS_WRAPPER_SANDBOX}
          allow={CANVAS_PERMISSIONS}
          srcDoc={doc}
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
        />
      )}

      <div className={css.Footer}>
        {staged && (
          <div className={css.Staged}>
            <Text size="T300">
              {t('mindroomUi.canvas.sendTo', { agent: agentName })}{' '}
              <b>{staged.submission.label ?? t('mindroomUi.canvas.unlabeled')}</b>
            </Text>
            <Text size="T200" priority="300">
              {t('mindroomUi.canvas.changeAnswer')}
            </Text>
            <details>
              <summary>
                <Text as="span" size="T200">
                  {t('mindroomUi.canvas.data')}
                </Text>
              </summary>
              <pre className={css.Data}>{formatData(staged.submission.data)}</pre>
            </details>
            <Box gap="200">
              <Button
                size="300"
                variant="Primary"
                disabled={!staged.armed || send.status === 'sending'}
                onClick={handleSend}
                data-canvas-send
              >
                <Text size="B300">{t('mindroomUi.canvas.send')}</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill="None"
                disabled={send.status === 'sending'}
                onClick={handleDiscard}
                data-canvas-discard
              >
                <Text size="B300">{t('mindroomUi.canvas.discard')}</Text>
              </Button>
            </Box>
          </div>
        )}
        <Text
          size="T200"
          role="status"
          priority="300"
          className={send.status === 'failed' ? css.Error : undefined}
        >
          {send.status === 'idle' && t('mindroomUi.canvas.disclosure', { agent: agentName })}
          {send.status === 'sending' && t('mindroomUi.canvas.sending', { agent: agentName })}
          {send.status === 'sent' &&
            t('mindroomUi.canvas.sent', { agent: agentName, label: send.label })}
          {send.status === 'failed' && t('mindroomUi.canvas.sendFailed')}
        </Text>
      </div>
    </aside>
  );
}
