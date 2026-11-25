import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import {
  canvasDocumentKey,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_SUBMIT_MESSAGE,
  canvasFrameWindow,
  type CanvasColorScheme,
  type CanvasSaved,
} from './canvasDocument';
import {
  buildCanvasErrorContent,
  buildCanvasResponseContent,
  buildCanvasResponsePreview,
  canvasResponseFitsInEvent,
  readCanvasError,
  readCanvasState,
  readCanvasSubmission,
  type CanvasSubmission,
} from './canvasMessages';
import type { CanvasTheme } from './canvasTheme';
import { useLocalEchoStatus } from '../useLocalEchoStatus';
import { uploadLongTextSidecar } from '../../matrix/send/longTextSidecarUpload';

/** A new snapshot cannot be sent by a click that was already on its way. */
export const CANVAS_SEND_ARM_DELAY_MS = 500;

/** Grace window to undo a gesture-triggered submission before it sends automatically. */
export const CANVAS_UNDO_DELAY_MS = 2500;

/** Cooldown after Undo or a gesture send, longer than Chromium's ~5 s transient user activation. */
export const CANVAS_GESTURE_COOLDOWN_MS = 5500;

export type CanvasView = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  title: string;
  html: string;
  /** Shown exactly as written, without Chat's styles. */
  raw?: true;
  /** The libraries Chat serves that this revision names. */
  libraries?: string[];
  /** The viewport width a page in the thread is laid out at, shrunk to fit its column. */
  width?: number;
  /** An uploaded page that is still downloading, or could not be loaded. */
  status?: 'loading' | 'failed';
};

export type StagedPhase = 'arming' | 'countdown' | 'paused' | 'ready';

export type Staged = {
  submission: CanvasSubmission;
  phase: StagedPhase;
  /** The page submitted again while this answer waited; only then does the user need to hear how to change it. */
  resubmitted?: true;
};

// Submissions arrive as canonical JSON (`readCanvasSubmission`), so equal answers stringify equally.
const sameAnswer = (a: CanvasSubmission, b: CanvasSubmission): boolean =>
  a.label === b.label && JSON.stringify(a.data) === JSON.stringify(b.data);

/** The last answer this host sent: its SDK local echo, which also drives the timeline. */
export type SentAnswer = { echo: MatrixEvent; label: string };

export type AnswerState = 'sending' | 'sent' | 'failed' | 'cancelled';

/** Errors the page reported that the user has not sent yet, or the last ones they sent. */
export type PageErrors = { errors: string[]; report?: { echo?: MatrixEvent; errors: string[] } };
const NO_PAGE_ERRORS: PageErrors = { errors: [] };
// Enough to say what went wrong; a page cannot fill the report.
const MAX_PAGE_ERRORS = 5;

// SENT counts as sent: the server has the message even if /sync never brings its copy.
const answerState = (status: EventStatus | null): AnswerState => {
  if (status === EventStatus.NOT_SENT) return 'failed';
  if (status === EventStatus.CANCELLED) return 'cancelled';
  if (status === null || status === EventStatus.SENT) return 'sent';
  return 'sending';
};

/** An answer still sending or failed holds the host: one unresolved answer at a time. */
const isUnresolved = (answer?: SentAnswer): boolean => {
  const state = answer && answerState(answer.echo.status);
  return state === 'sending' || state === 'failed';
};

const STAGE_INTERVAL_MS = 100;

export type CanvasShown = CanvasView & { colorScheme: CanvasColorScheme; theme: CanvasTheme };

const revisionKey = (canvas: CanvasView, htmlKey: string) =>
  `${canvas.revisionEventId}\n${canvas.status ?? 'ready'}\n${canvas.title}\n${htmlKey}`;

export type CanvasHostOptions = {
  mx: MatrixClient;
  room: Room;
  canvas: CanvasView;
  agentName: string;
  colorScheme: CanvasColorScheme;
  theme: CanvasTheme;
  /** Builds the document of the page shown, again only when it or `buildKey` changes. */
  build: (shown: CanvasShown) => string;
  buildKey: string;
  /** `byUser` is false for what the page saves before the user has worked in it. */
  onSaveState?: (change: CanvasSaved, byUser: boolean) => void;
};

export type CanvasFooter = AnswerState | 'idle' | 'refused';

/**
 * What hosts a canvas page: the page shown and its updates, the answers it offers and their
 * sending, the errors it reports, and the saves it makes. The caller lays it out.
 */
export function useCanvasHost({
  mx,
  room,
  canvas,
  agentName,
  colorScheme,
  theme,
  build,
  buildKey,
  onSaveState,
}: CanvasHostOptions) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The theme is fixed when a revision is shown, so switching themes cannot discard unsent work.
  const [displayed, setDisplayed] = useState<CanvasShown>(() => ({
    ...canvas,
    colorScheme,
    theme,
  }));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const buildNow = useRef(build);
  buildNow.current = build;
  // Saving never rebuilds the page; every page shown, and every reload, starts from the latest saved state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => buildNow.current(displayed), [displayed, buildKey]);
  const docKey = useMemo(() => canvasDocumentKey(doc), [doc]);
  const frameKey = `${displayed.revisionEventId}:${docKey}:${buildKey}`;
  const [escapedFrame, setEscapedFrame] = useState<string>();
  const [staged, setStaged] = useState<Staged>();
  // Once sent, an answer belongs to the SDK and the timeline; the host only shows its status.
  const [lastAnswer, setLastAnswer] = useState<SentAnswer>();
  const [sendError, setSendError] = useState(false);
  // An answer too large for one event is uploaded before its event exists.
  const [uploading, setUploading] = useState(false);
  const [pageErrors, setPageErrors] = useState(NO_PAGE_ERRORS);
  // The listed errors as of the last message, read by the message handler.
  const pageErrorsNow = useRef(pageErrors);
  pageErrorsNow.current = pageErrors;
  // Every error this page reported, so one already sent is not offered again.
  const seenErrors = useRef(new Set<string>());
  // The answer being uploaded; Discard clears it, which cancels sending it.
  const uploadingSubmission = useRef<CanvasSubmission>(undefined);
  const stagedNow = useRef<Staged>(undefined);
  const updateStaged = useCallback(
    (next: Staged | undefined | ((current: Staged | undefined) => Staged | undefined)) => {
      const resolved = typeof next === 'function' ? next(stagedNow.current) : next;
      if (resolved === stagedNow.current) return;
      stagedNow.current = resolved;
      setStaged(resolved);
    },
    []
  );
  const busyNow = useRef(false);
  // Blocks follow-up auto-sends within the same transient browser activation window.
  const gestureCooldownUntil = useRef(0);
  // Focus left on the iframe after a completed send does not count as unsent work until new input.
  const staleFocusAfterSend = useRef(false);
  const loads = useRef({ frameKey, count: 0 });
  const currentFrameKey = useRef(frameKey);
  currentFrameKey.current = frameKey;
  // Whether the frame may hold work the user has not sent since it loaded or since their last send.
  const touched = useRef(false);
  // Whether the user has worked in this page since it loaded; what the page saves before that is not theirs.
  const used = useRef(false);
  const lastStageAt = useRef(0);
  const latest = useRef({ canvas, colorScheme, theme, onSaveState });
  latest.current = { canvas, colorScheme, theme, onSaveState };
  // Pages can be megabytes, so revisions compare by a hash of their HTML.
  const incomingHtmlKey = useMemo(() => canvasDocumentKey(canvas.html), [canvas.html]);
  const displayedHtmlKey = useMemo(() => canvasDocumentKey(displayed.html), [displayed.html]);
  const handledRevision = useRef(revisionKey(canvas, incomingHtmlKey));
  // The update held behind Load update; its page finishing its download is not a new update.
  const heldRevisionId = useRef<string>(undefined);

  const shownRevisionId = displayed.revisionEventId;
  const frameRevisionId = useRef(shownRevisionId);
  useEffect(() => {
    // The same revision starting again (a restart after an escape) keeps an answer the user already
    // sent from it and that is still uploading, with its Discard and, if the upload fails, Send.
    const sameRevision = frameRevisionId.current === shownRevisionId;
    frameRevisionId.current = shownRevisionId;
    const current = stagedNow.current;
    const sending =
      sameRevision && current && current.submission === uploadingSubmission.current
        ? current
        : undefined;
    touched.current = !!sending;
    used.current = false;
    lastStageAt.current = 0;
    gestureCooldownUntil.current = 0;
    staleFocusAfterSend.current = false;
    updateStaged(sending);
    setSendError(false);
    // An answer still sending or failed stays, with its Retry and Delete, across a new page.
    setLastAnswer((current) => (isUnresolved(current) ? current : undefined));
    // An update held behind Load update stays held when the same page starts again.
  }, [frameKey, shownRevisionId, updateStaged]);

  // Reset error state in layout phase so the previous alert unmounts before paint and before the
  // new iframe can post errors that would race with a passive effect.
  useLayoutEffect(() => {
    pageErrorsNow.current = NO_PAGE_ERRORS;
    seenErrors.current = new Set();
    setPageErrors(NO_PAGE_ERRORS);
  }, [frameKey]);

  // An update loads at once unless it would discard work the user has not sent.
  const incomingRevision = revisionKey(canvas, incomingHtmlKey);
  const displayedRevision = revisionKey(displayed, displayedHtmlKey);
  const displayedRevisionId = displayed.revisionEventId;
  const displayedPending = !!displayed.status;
  useEffect(() => {
    if (incomingRevision === displayedRevision) {
      handledRevision.current = incomingRevision;
      heldRevisionId.current = undefined;
      setUpdateAvailable(false);
      return;
    }
    // Each revision is decided once, so a later re-render cannot drop a newer staged answer.
    if (handledRevision.current === incomingRevision) return;
    handledRevision.current = incomingRevision;
    // A page that finished downloading belongs to the revision already shown.
    const sameRevisionLoaded =
      latest.current.canvas.revisionEventId === displayedRevisionId && displayedPending;
    const frameActive = document.activeElement === frameRef.current && !staleFocusAfterSend.current;
    if (sameRevisionLoaded || (!touched.current && !frameActive)) {
      setDisplayed({
        ...latest.current.canvas,
        colorScheme: latest.current.colorScheme,
        theme: latest.current.theme,
      });
    } else if (heldRevisionId.current !== latest.current.canvas.revisionEventId) {
      heldRevisionId.current = latest.current.canvas.revisionEventId;
      // An answer the user is already sending stays until it is sent or its upload fails.
      updateStaged((current) =>
        current && current.submission === uploadingSubmission.current ? current : undefined
      );
      setUpdateAvailable(true);
    }
  }, [incomingRevision, displayedRevision, displayedRevisionId, displayedPending, updateStaged]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement !== frameRef.current) return;
      touched.current = true;
      used.current = true;
      staleFocusAfterSend.current = false;
    };
    const stageSubmission = (event: MessageEvent, source: Window, trustedGesture: boolean) => {
      // Size reports and other messages leave the snapshot budget alone.
      if (event.data?.type !== CANVAS_SUBMIT_MESSAGE) return;
      const now = Date.now();
      // Bound bridge traffic before parsing; a canvas cannot flood the host with snapshots.
      if (now - lastStageAt.current < STAGE_INTERVAL_MS) return;
      lastStageAt.current = now;
      const submission = readCanvasSubmission(event, source, { trustedGesture });
      if (!submission) return;
      touched.current = true;
      staleFocusAfterSend.current = false;
      // A pending snapshot stays exactly what the user is reviewing until they send or discard
      // it, so a canvas cannot swap the payload under the user's click.
      updateStaged((current) => {
        if (!current) {
          const canAutoSend =
            trustedGesture &&
            submission.userGesture === true &&
            document.activeElement === frameRef.current &&
            now >= gestureCooldownUntil.current;
          if (canAutoSend) {
            return { submission, phase: busyNow.current ? 'paused' : 'countdown' };
          }
          return { submission, phase: 'arming' };
        }
        if (sameAnswer(current.submission, submission)) return current;
        if (current.resubmitted && current.phase !== 'countdown') return current;
        return {
          ...current,
          phase: current.phase === 'countdown' ? 'paused' : current.phase,
          resubmitted: true,
        };
      });
    };
    const handleMessage = (event: MessageEvent) => {
      const wrapper = frameRef.current?.contentWindow;
      if (wrapper && event.source === wrapper && event.origin === 'null') {
        if (event.data?.type === CANVAS_ESCAPE_MESSAGE) {
          // The wrapper reports that the canvas frame tried to load something else.
          setEscapedFrame(currentFrameKey.current);
          return;
        }
        stageSubmission(event, wrapper, true);
        return;
      }
      const frame = canvasFrameWindow(frameRef.current);
      if (!frame || event.source !== frame) return;
      const saved = readCanvasState(event, frame);
      if (saved !== undefined) {
        // The page's own focus() cannot fake user activation; focus is the fallback where it is unknown.
        const byUser = saved.user ?? (used.current || document.activeElement === frameRef.current);
        if (byUser) staleFocusAfterSend.current = false;
        latest.current.onSaveState?.(saved.change, byUser);
        return;
      }
      const error = readCanvasError(event, frame);
      if (error !== undefined) {
        const listed = pageErrorsNow.current;
        // A report still sending or failed may return to the list, so its errors count toward the five.
        const { report } = listed;
        const held =
          report?.echo && ['sending', 'failed'].includes(answerState(report.echo.status))
            ? report.errors.length
            : 0;
        // Only listed errors are remembered, so a page throwing endlessly stores five at a time.
        if (seenErrors.current.has(error) || listed.errors.length + held >= MAX_PAGE_ERRORS) return;
        seenErrors.current.add(error);
        const next = { ...listed, errors: [...listed.errors, error] };
        pageErrorsNow.current = next;
        setPageErrors(next);
        return;
      }
      // Direct inner-frame submissions never carry trusted gesture attestation.
      stageSubmission(event, frame, false);
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('message', handleMessage);
    };
  }, [mx, updateStaged]);

  const stagedSubmission = staged?.submission;
  const stagedPhase = staged?.phase;
  useEffect(() => {
    if (!stagedSubmission || stagedPhase !== 'arming') return undefined;
    const timer = window.setTimeout(
      () =>
        updateStaged((current) =>
          current?.submission === stagedSubmission && current.phase === 'arming'
            ? { ...current, phase: 'ready' }
            : current
        ),
      CANVAS_SEND_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [stagedPhase, stagedSubmission, updateStaged]);

  const answerStatus = useLocalEchoStatus(lastAnswer?.echo);
  const answer = lastAnswer && answerStatus !== undefined ? answerState(answerStatus) : undefined;
  const answerOpen = answer === 'sending' || answer === 'failed';

  const busy = answerOpen || uploading;
  // A refused send or an upload happen only while no answer is open, so they take priority.
  let footer: CanvasFooter = answer ?? 'idle';
  if (uploading) footer = 'sending';
  if (sendError) footer = 'refused';

  // Hands one event to the SDK; from then on its local echo carries the answer's status.
  const deliver = useCallback(
    (
      eventContent: Record<string, unknown>,
      label: string,
      submission: CanvasSubmission
    ): boolean => {
      const txnId = mx.makeTxnId();
      let sending: Promise<unknown>;
      try {
        // The relation travels in the content. The SDK adds the local echo before this returns.
        sending = mx.sendMessage(room.roomId, eventContent as never, txnId);
      } catch {
        return false;
      }
      // A failure shows through the echo's status, here and in the timeline.
      sending.catch(() => undefined);
      const echo = room.getEventForTxnId(txnId);
      // A newer snapshot staged during an upload stays.
      if (stagedNow.current?.submission === submission) {
        if (stagedNow.current.phase === 'countdown' || submission.userGesture === true) {
          gestureCooldownUntil.current = Date.now() + CANVAS_GESTURE_COOLDOWN_MS;
        }
        updateStaged(undefined);
        // Work in the frame after this answer marks it again.
        touched.current = false;
        staleFocusAfterSend.current = document.activeElement === frameRef.current;
      }
      setLastAnswer(echo ? { echo, label } : undefined);
      return true;
    },
    [mx, room, updateStaged]
  );

  busyNow.current = busy;

  const handleSend = useCallback(() => {
    const currentStaged = stagedNow.current;
    if (!currentStaged || currentStaged.phase === 'arming' || busyNow.current) return;
    const { submission } = currentStaged;
    if (uploadingSubmission.current === submission) return;
    const label = submission.label ?? t('mindroomUi.canvas.unlabeled');
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
    setSendError(false);
    const stopCountdown = () =>
      updateStaged((current) =>
        current?.submission === submission && current.phase === 'countdown'
          ? { ...current, phase: 'paused' }
          : current
      );
    // Until the answer is handed to the SDK, the frame still holds the user's work, so an update
    // during an upload waits for "Load update" and a failed upload can be tried again.
    const refused = () => {
      setSendError(true);
      // Do not loop auto-send after a refusal; leave it paused for an explicit retry.
      stopCountdown();
      // The snapshot stays unsent, so an update must not replace the page without asking.
      touched.current = true;
    };
    if (canvasResponseFitsInEvent(content)) {
      if (!deliver(content, label, submission)) refused();
      return;
    }
    // Too large for one event: upload the whole answer and send a preview that points at it,
    // as MindRoom sends long replies. The snapshot stays until the preview is handed to the SDK,
    // and Discard until then cancels the answer.
    uploadingSubmission.current = submission;
    setUploading(true);
    stopCountdown();
    const current = () => uploadingSubmission.current === submission;
    uploadLongTextSidecar(mx, room, content, buildCanvasResponsePreview(content))
      .then((preview) => {
        if (current() && !deliver(preview, label, submission)) refused();
      })
      .catch(() => {
        if (current()) refused();
      })
      .finally(() => {
        if (!current()) return;
        uploadingSubmission.current = undefined;
        setUploading(false);
      });
  }, [agentName, deliver, displayed, mx, room, t, updateStaged]);

  const sendNow = useRef(handleSend);
  sendNow.current = handleSend;
  useEffect(() => {
    if (!stagedSubmission || stagedPhase !== 'countdown' || busy) return undefined;
    const timer = window.setTimeout(() => {
      if (
        stagedNow.current?.submission === stagedSubmission &&
        stagedNow.current.phase === 'countdown'
      ) {
        sendNow.current();
      }
    }, CANVAS_UNDO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [busy, stagedPhase, stagedSubmission]);

  const reportStatus = useLocalEchoStatus(pageErrors.report?.echo);
  const reportState =
    pageErrors.report?.echo && reportStatus !== undefined ? answerState(reportStatus) : undefined;
  // One report at a time, as with answers; new errors keep collecting meanwhile.
  const reportOpen = reportState === 'sending' || reportState === 'failed';
  useEffect(() => {
    // A report the user deleted after it failed was never sent, so its errors are offered again.
    if (reportState === 'cancelled') {
      setPageErrors((current) => ({
        errors: [...(current.report?.errors ?? []), ...current.errors],
      }));
    }
  }, [reportState]);

  // The user sees the errors before choosing to send them, as with an answer.
  const handleReport = useCallback(() => {
    if (reportOpen || pageErrors.errors.length === 0) return;
    const sent = pageErrors.errors;
    const content = buildCanvasErrorContent(
      {
        eventId: displayed.eventId,
        revisionEventId: displayed.revisionEventId,
        agentUserId: displayed.agentUserId,
        agentName,
        threadId: displayed.threadId,
      },
      sent
    );
    const txnId = mx.makeTxnId();
    try {
      // A failure shows through the echo's status, here and in the timeline.
      mx.sendMessage(room.roomId, content as never, txnId).catch(() => undefined);
    } catch {
      return;
    }
    const echo = room.getEventForTxnId(txnId) ?? undefined;
    setPageErrors((current) => ({
      errors: current.errors.filter((error) => !sent.includes(error)),
      report: { echo, errors: sent },
    }));
  }, [agentName, displayed, mx, pageErrors, reportOpen, room]);

  const handlePause = useCallback(() => {
    updateStaged((current) =>
      current?.phase === 'countdown' ? { ...current, phase: 'paused' } : current
    );
  }, [updateStaged]);

  const handleDiscard = useCallback(() => {
    const current = stagedNow.current;
    // Discarding the answer being uploaded cancels it; a newer snapshot leaves that upload alone.
    if (uploadingSubmission.current === current?.submission) {
      uploadingSubmission.current = undefined;
      setUploading(false);
    }
    if (current?.phase === 'countdown' || current?.phase === 'paused') {
      gestureCooldownUntil.current = Date.now() + CANVAS_GESTURE_COOLDOWN_MS;
      if (frameRef.current && document.activeElement === frameRef.current) {
        frameRef.current.blur();
      }
    }
    updateStaged(undefined);
    setSendError(false);
  }, [updateStaged]);

  const handleLoad = useCallback(() => {
    if (loads.current.frameKey !== frameKey) loads.current = { frameKey, count: 0 };
    loads.current.count += 1;
    // The wrapper's document is inline and nothing inside may navigate it, so a later load is an escape.
    if (loads.current.count > 1) setEscapedFrame(frameKey);
  }, [frameKey]);

  return {
    frameRef,
    displayed,
    doc,
    frameKey,
    staged,
    lastAnswer,
    answer,
    busy,
    footer,
    sendError,
    send: handleSend,
    pause: handlePause,
    discard: handleDiscard,
    pageErrors,
    reportState,
    reportOpen,
    report: handleReport,
    updateAvailable,
    loadUpdate: () => setDisplayed({ ...canvas, colorScheme, theme }),
    escaped: escapedFrame === frameKey,
    handleLoad,
    // An answer waiting or sending belongs to the version shown, so the version stays until it resolves.
    locked: !!staged || busy,
    /** The user chose another page, as with Load update, so it replaces this one at once. */
    chosen: () => {
      touched.current = false;
    },
  };
}

export type CanvasHost = ReturnType<typeof useCanvasHost>;
