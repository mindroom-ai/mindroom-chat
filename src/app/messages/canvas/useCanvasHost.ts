import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import {
  canvasDocumentKey,
  CANVAS_ESCAPE_MESSAGE,
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

export type CanvasView = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  title: string;
  html: string;
  /** Shown exactly as written, without Chat's styles. */
  raw?: true;
  /** An uploaded page that is still downloading, or could not be loaded. */
  status?: 'loading' | 'failed';
};

export type Staged = {
  submission: CanvasSubmission;
  armed: boolean;
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
  const uploadingSubmission = useRef<CanvasSubmission>();
  const stagedNow = useRef(staged);
  stagedNow.current = staged;
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

  useEffect(() => {
    touched.current = false;
    used.current = false;
    lastStageAt.current = 0;
    setStaged(undefined);
    setSendError(false);
    // An answer still sending or failed stays, with its Retry and Delete, across a new page.
    setLastAnswer((current) => (isUnresolved(current) ? current : undefined));
    setUpdateAvailable(false);
    setPageErrors(NO_PAGE_ERRORS);
    seenErrors.current = new Set();
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
      // An answer the user is already sending stays until it is sent or its upload fails.
      setStaged((current) =>
        current && current.submission === uploadingSubmission.current ? current : undefined
      );
      setUpdateAvailable(true);
    }
  }, [incomingRevision, displayedRevision, displayedRevisionId, displayedPending]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement !== frameRef.current) return;
      touched.current = true;
      used.current = true;
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
      const saved = readCanvasState(event, frame);
      if (saved !== undefined) {
        // The page's own focus() cannot fake user activation; focus is the fallback where it is unknown.
        const byUser = saved.user ?? (used.current || document.activeElement === frameRef.current);
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
      const now = Date.now();
      // Bound bridge traffic before parsing; a canvas cannot flood the host with snapshots.
      if (now - lastStageAt.current < STAGE_INTERVAL_MS) return;
      lastStageAt.current = now;
      const submission = readCanvasSubmission(event, frame);
      if (!submission) return;
      touched.current = true;
      // A pending snapshot stays exactly what the user is reviewing until they send or discard
      // it, so a canvas cannot swap the payload under the user's click.
      setStaged((current) => {
        if (!current) return { submission, armed: false };
        return current.resubmitted || sameAnswer(current.submission, submission)
          ? current
          : { ...current, resubmitted: true };
      });
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('message', handleMessage);
    };
  }, [mx]);

  const stagedSubmission = staged?.submission;
  useEffect(() => {
    if (!stagedSubmission) return undefined;
    const timer = window.setTimeout(
      () =>
        setStaged((current) =>
          current?.submission === stagedSubmission ? { ...current, armed: true } : current
        ),
      CANVAS_SEND_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [stagedSubmission]);

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
        setStaged(undefined);
        // Work in the frame after this answer marks it again.
        touched.current = false;
      }
      setLastAnswer(echo ? { echo, label } : undefined);
      return true;
    },
    [mx, room]
  );

  const handleSend = useCallback(() => {
    if (!staged?.armed || busy) return;
    const { submission } = staged;
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
    // Until the answer is handed to the SDK, the frame still holds the user's work, so an update
    // during an upload waits for "Load update" and a failed upload can be tried again.
    const refused = () => {
      setSendError(true);
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
  }, [agentName, busy, deliver, displayed, mx, room, staged, t]);

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

  const handleDiscard = useCallback(() => {
    // Discarding the answer being uploaded cancels it; a newer snapshot leaves that upload alone.
    if (uploadingSubmission.current === stagedNow.current?.submission) {
      uploadingSubmission.current = undefined;
      setUploading(false);
    }
    setStaged(undefined);
    setSendError(false);
  }, []);

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
