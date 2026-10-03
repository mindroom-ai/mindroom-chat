import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventStatus, type MatrixClient } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, type IconSrc, Text } from 'folds';
import {
  buildCanvasDocument,
  CANVAS_PERMISSIONS,
  CANVAS_SANDBOX,
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

type SendState =
  | { status: 'idle' }
  | { status: 'sending'; label: string }
  | { status: 'sent'; label: string }
  | { status: 'failed' };

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
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The theme is fixed when a revision is shown, so switching themes cannot discard unsent work.
  const [displayed, setDisplayed] = useState<Displayed>(() => ({
    ...canvas,
    colorScheme,
    theme,
  }));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const doc = useMemo(
    () => buildCanvasDocument(displayed.html, displayed.colorScheme, displayed.theme),
    [displayed.html, displayed.colorScheme, displayed.theme]
  );
  const [reloads, setReloads] = useState(0);
  const docKey = useMemo(() => documentKey(doc), [doc]);
  const frameKey = `${displayed.revisionEventId}:${docKey}:${reloads}`;
  const [escapedFrame, setEscapedFrame] = useState<string>();
  const [staged, setStaged] = useState<Staged>();
  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const loads = useRef({ frameKey, count: 0 });
  // Whether the frame may hold work the user has not sent since it loaded or since their last send.
  const touched = useRef(false);
  const lastStageAt = useRef(0);
  const latest = useRef({ canvas, colorScheme, theme });
  latest.current = { canvas, colorScheme, theme };
  // Pages can be megabytes, so revisions compare by a hash of their HTML.
  const incomingHtmlKey = useMemo(() => documentKey(canvas.html), [canvas.html]);
  const displayedHtmlKey = useMemo(() => documentKey(displayed.html), [displayed.html]);
  const handledRevision = useRef(revisionKey(canvas, incomingHtmlKey));

  useEffect(() => {
    touched.current = false;
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
      setStaged(undefined);
      setUpdateAvailable(true);
    }
  }, [incomingRevision, displayedRevision, displayedRevisionId, displayedPending]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement === frameRef.current) touched.current = true;
    };
    const handleMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
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

  const handleSend = useCallback(async () => {
    if (!staged?.armed || send.status === 'sending') return;
    const { submission, txnId } = staged;
    const label = submission.label ?? 'Submitted';
    const room = mx.getRoom(roomId);
    const echo = room?.getEventForTxnId(txnId);
    if (echo && echo.status !== EventStatus.NOT_SENT) {
      // The timeline's own Retry or Discard already took over this answer.
      setStaged(undefined);
      setSend(
        echo.status === EventStatus.CANCELLED ? { status: 'idle' } : { status: 'sent', label }
      );
      return;
    }
    setSend({ status: 'sending', label });
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
      setStaged((current) => (current?.txnId === txnId ? undefined : current));
      setSend({ status: 'sent', label });
    } catch {
      touched.current = true;
      setSend({ status: 'failed' });
    }
  }, [agentName, displayed, mx, roomId, send.status, staged]);

  const handleDiscard = useCallback(() => {
    const failedEcho = staged && mx.getRoom(roomId)?.getEventForTxnId(staged.txnId);
    if (failedEcho?.status === EventStatus.NOT_SENT) mx.cancelPendingEvent(failedEcho);
    setStaged(undefined);
    setSend((current) => (current.status === 'failed' ? { status: 'idle' } : current));
  }, [mx, roomId, staged]);

  const handleLoad = useCallback(() => {
    if (loads.current.frameKey !== frameKey) loads.current = { frameKey, count: 0 };
    loads.current.count += 1;
    // The document is inline, so any later load means the canvas navigated itself.
    if (loads.current.count > 1) setEscapedFrame(frameKey);
  }, [frameKey]);

  const escaped = escapedFrame === frameKey;

  return (
    <aside className={css.Panel} aria-label="Canvas panel">
      <div className={css.Header}>
        <Box alignItems="Center" gap="200">
          <Icon size="300" src={Icons.Category} />
          <div className={css.Title}>
            <Text size="H4" truncate>
              {displayed.title}
            </Text>
            <Text size="T200" priority="300" truncate>
              Interactive panel from {agentName}
            </Text>
          </div>
        </Box>
        <Box alignItems="Center" gap="100">
          {onToggleExpanded && (
            <IconButton
              onClick={onToggleExpanded}
              aria-label="Expand canvas"
              aria-pressed={expanded}
              size="300"
            >
              <Icon size="300" src={expanded ? ShrinkIcon : ExpandIcon} />
            </IconButton>
          )}
          <IconButton onClick={onClose} aria-label="Close canvas" size="300">
            <Icon size="300" src={Icons.Cross} />
          </IconButton>
        </Box>
      </div>

      {updateAvailable && (
        <div className={css.Notice} role="status">
          <Text size="T300">{agentName} updated this panel.</Text>
          <Button
            size="300"
            variant="Secondary"
            onClick={() => setDisplayed({ ...canvas, colorScheme, theme })}
          >
            <Text size="B300">Load update</Text>
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
            {displayed.status === 'loading' ? 'Loading panel…' : 'This panel could not be loaded.'}
          </Text>
          {displayed.status === 'failed' && onRetry && (
            <Button size="300" variant="Secondary" onClick={onRetry}>
              <Text size="B300">Retry</Text>
            </Button>
          )}
        </Box>
      )}
      {!displayed.status && escaped && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text className={css.Error} size="T300" role="alert">
            This panel tried to leave its sandbox and was stopped.
          </Text>
          <Button
            size="300"
            variant="Secondary"
            data-canvas-reload
            onClick={() => setReloads((count) => count + 1)}
          >
            <Text size="B300">Reload panel</Text>
          </Button>
        </Box>
      )}
      {!displayed.status && !escaped && (
        <iframe
          key={frameKey}
          ref={frameRef}
          className={css.Frame}
          title={displayed.title}
          sandbox={CANVAS_SANDBOX}
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
              Send to {agentName}: <b>{staged.submission.label ?? 'Submitted'}</b>
            </Text>
            <Text size="T200" priority="300">
              To change your answer, discard this one first.
            </Text>
            <details>
              <summary>
                <Text as="span" size="T200">
                  Data
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
                <Text size="B300">Send</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill="None"
                disabled={send.status === 'sending'}
                onClick={handleDiscard}
                data-canvas-discard
              >
                <Text size="B300">Discard</Text>
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
          {send.status === 'idle' &&
            `Made by ${agentName}. It cannot access your account; what you enter here may leave this panel.`}
          {send.status === 'sending' && `Sending to ${agentName}…`}
          {send.status === 'sent' && `Sent to ${agentName}: ${send.label}`}
          {send.status === 'failed' && 'Could not send your response. Try again.'}
        </Text>
      </div>
    </aside>
  );
}
