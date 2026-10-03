import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
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
};

export type CanvasPanelProps = {
  mx: MatrixClient;
  roomId: string;
  canvas: CanvasView;
  agentName: string;
  colorScheme: CanvasColorScheme;
  onClose: () => void;
};

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

export function CanvasPanel({
  mx,
  roomId,
  canvas,
  agentName,
  colorScheme,
  onClose,
}: CanvasPanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [displayed, setDisplayed] = useState(canvas);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const doc = useMemo(
    () => buildCanvasDocument(displayed.html, colorScheme),
    [displayed.html, colorScheme]
  );
  const [reloads, setReloads] = useState(0);
  const frameKey = `${displayed.revisionEventId}:${documentKey(doc)}:${reloads}`;
  const [escapedFrame, setEscapedFrame] = useState<string>();
  const [staged, setStaged] = useState<Staged>();
  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const loads = useRef(0);
  // Whether the frame may hold work the user has not sent since it loaded or since their last send.
  const touched = useRef(false);
  const lastStageAt = useRef(0);

  useEffect(() => {
    loads.current = 0;
    touched.current = false;
    setStaged(undefined);
    setSend({ status: 'idle' });
    setUpdateAvailable(false);
  }, [frameKey]);

  // An update loads at once unless it would discard work the user has not sent.
  useEffect(() => {
    if (
      canvas.revisionEventId === displayed.revisionEventId &&
      canvas.html === displayed.html &&
      canvas.title === displayed.title
    ) {
      setUpdateAvailable(false);
      return;
    }
    if (!touched.current) setDisplayed(canvas);
    else {
      setStaged(undefined);
      setUpdateAvailable(true);
    }
  }, [canvas, displayed]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement === frameRef.current) touched.current = true;
    };
    const handleMessage = (event: MessageEvent) => {
      const submission = readCanvasSubmission(event, frameRef.current?.contentWindow);
      if (!submission) return;
      const now = Date.now();
      // Bound bridge traffic; a canvas cannot flood the host with snapshots.
      if (now - lastStageAt.current < STAGE_INTERVAL_MS) return;
      lastStageAt.current = now;
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

  const handleSend = useCallback(() => {
    if (!staged?.armed || send.status === 'sending') return;
    const { submission, txnId } = staged;
    const label = submission.label ?? 'Submitted';
    setSend({ status: 'sending', label });
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
    mx
      // The relation travels in the content; the transaction ID makes a retry idempotent.
      .sendMessage(roomId, content as never, txnId)
      .then(() => {
        touched.current = false;
        setStaged((current) => (current?.txnId === txnId ? undefined : current));
        setSend({ status: 'sent', label });
      })
      .catch(() => setSend({ status: 'failed' }));
  }, [agentName, displayed, mx, roomId, send.status, staged]);

  const handleLoad = useCallback(() => {
    loads.current += 1;
    // The document is inline, so any later load means the canvas navigated itself.
    if (loads.current > 1) setEscapedFrame(frameKey);
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
        <IconButton onClick={onClose} aria-label="Close canvas" size="300">
          <Icon size="300" src={Icons.Cross} />
        </IconButton>
      </div>

      {updateAvailable && (
        <div className={css.Notice} role="status">
          <Text size="T300">{agentName} updated this panel.</Text>
          <Button size="300" variant="Secondary" onClick={() => setDisplayed(canvas)}>
            <Text size="B300">Load update</Text>
          </Button>
        </div>
      )}

      {escaped ? (
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
      ) : (
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
                onClick={() => setStaged(undefined)}
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
