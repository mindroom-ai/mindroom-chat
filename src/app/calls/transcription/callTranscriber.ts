import type { IOpenIDToken } from 'matrix-js-sdk';
import {
  TranscriptionApiError,
  TranscriptionClient,
  isNotTranscribed,
  isUnavailable,
  type TranscriptCall,
} from './api';
import { pollLiveCall, sleep } from './liveCallPoll';
import { startSpeechCapture, type SpeechCapture, type SpeechStretch } from './speechCapture';
import type { LiveUpdate } from './transcriptionState';

/** How often this device checks in with the call; MindRoom counts it out after 60 s without. */
const HEARTBEAT_MS = 20_000;
/** How often this device reads the live call while it is in it. */
const LIVE_READ_MS = 2_000;
/** An upload gives up after this long, its retry included. */
const UPLOAD_TIMEOUT_MS = 30_000;
/** The longest a stretch refused as too many waits for its one retry. */
const MAX_RETRY_AFTER_MS = 10_000;
/** A refusal that does not say when to try again is tried again after this long. */
const DEFAULT_RETRY_AFTER_MS = 1_000;
/**
 * Joining, leaving and each Pause request give up after this long, before the next check-in is
 * due; a request given up on got no answer.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * `joining` until MindRoom first answers (and silently while it does not); `transcribing`;
 * `unavailable` while it cannot be reached or fails after it once answered; `off` for good once
 * it says this room is not transcribed.
 */
export type TranscriberStatus = 'joining' | 'transcribing' | 'unavailable' | 'off';

export type CallTranscriberOptions = {
  roomId: string;
  /** The room's MindRoom server. */
  apiUrl: string;
  /** A Matrix OpenID token bound to `apiUrl`. */
  getOpenIdToken: () => Promise<IOpenIDToken>;
  onStatus: (status: TranscriberStatus, callId: string | undefined) => void;
  /**
   * Each read of the room's live call, the line MindRoom answers each upload with, and the call it
   * answers each Pause with.
   */
  onUpdate: (update: LiveUpdate) => void;
  request?: typeof fetch;
  startCapture?: typeof startSpeechCapture;
};

/** Each room's last leave; a new join there waits for it. */
const leaves = new Map<string, Promise<void>>();

/** A timer's signal: aborts after `ms`, unless cleared first. */
const deadline = (ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

const withTimeout = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const timeout = deadline(ms);
  try {
    return await run(timeout.signal);
  } finally {
    timeout.clear();
  }
};

/**
 * Transcribes this device's own speech in one room call: joins MindRoom's call and checks in every
 * 20 seconds, finds speech in the microphone the call publishes and uploads each stretch, one at a
 * time, and reads the room's live call every 2 seconds. MindRoom unreachable or failing: nothing
 * is captured or sent until a check-in is answered again. A room MindRoom does not transcribe (404
 * or 403): nothing more at all.
 */
export class CallTranscriber {
  private readonly options: CallTranscriberOptions;

  private readonly client: TranscriptionClient;

  private readonly startCapture: typeof startSpeechCapture;

  private status: TranscriberStatus = 'joining';

  /** The call the last answered check-in named. */
  private callId?: string;

  /**
   * A call route answered in this call. Until one has, a failure stays silent: a server from
   * before this feature refuses these routes for good (its cross-origin rules), and is not down.
   */
  private answered = false;

  /** No check-in before this time, which MindRoom asked for with `Retry-After`. */
  private notBefore = 0;

  private retryTimer?: ReturnType<typeof setTimeout>;

  private ending = false;

  private started?: Promise<void>;

  private ended?: Promise<void>;

  private heartbeatTimer?: ReturnType<typeof setInterval>;

  /** A check-in on its way. */
  private joining?: Promise<void>;

  /** Joins and Pause requests MindRoom answered so far. */
  private answers = 0;

  /** The call MindRoom answered the last of them with. */
  private lastAnswer?: TranscriptCall;

  /** Stops reading the live call. */
  private readonly stopReading = new AbortController();

  private reading = false;

  /** The microphone to listen to; none while muted. */
  private track?: MediaStreamTrack;

  /** A Pause or Resume pressed on this device has no answer yet. */
  private requestPending = false;

  /** The call is paused, as the last answer or read that counts says. */
  private serverPaused = false;

  private capture?: { track: MediaStreamTrack; capture: SpeechCapture };

  /** Starting and stopping the capture, one step after the other. */
  private captureSteps: Promise<void> = Promise.resolve();

  /** The uploads, one after the other. */
  private uploads: Promise<void> = Promise.resolve();

  /** Raised to drop every upload still queued. */
  private uploadGeneration = 0;

  constructor(options: CallTranscriberOptions) {
    this.options = options;
    this.client = new TranscriptionClient({
      apiUrl: options.apiUrl,
      getOpenIdToken: options.getOpenIdToken,
      request: options.request,
    });
    this.startCapture = options.startCapture ?? startSpeechCapture;
  }

  /** Joins once the room's last leave is done, then checks in every 20 seconds. */
  start(): void {
    const { roomId } = this.options;
    this.started ??= (async () => {
      await leaves.get(roomId);
      if (this.ending) return;
      this.heartbeat();
      this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    })();
  }

  /** The microphone the call publishes now; none while it is muted. */
  setMicrophone(track: MediaStreamTrack | undefined): void {
    this.track = track;
    this.updateCapture();
  }

  /** Whether a Pause or Resume pressed here has no answer yet: capture pauses meanwhile. */
  setRequestPending(pending: boolean): void {
    this.requestPending = pending;
    this.applyPaused();
  }

  /** Capture pauses while a request pressed here has no answer, or while the call is paused. */
  private get paused(): boolean {
    return this.requestPending || this.serverPaused;
  }

  /** Tells capture whether it is paused; nothing else does. */
  private applyPaused(): void {
    this.capture?.capture.setPaused(this.paused);
  }

  /**
   * Pauses or resumes transcription of the joined call for everyone in it; MindRoom's answer is
   * handed on. Refused, the next read of the live call says how it is.
   */
  async pause(paused: boolean): Promise<void> {
    const { callId } = this;
    if (!callId || this.status !== 'transcribing' || this.ending) return;
    try {
      const call = await withTimeout(REQUEST_TIMEOUT_MS, (signal) =>
        this.client.pause(callId, paused, signal)
      );
      this.applyAnswer(call);
    } catch (error) {
      this.routeFailed(error);
    }
  }

  /**
   * Stops listening, lets the queued uploads finish (each gives up after 30 seconds), then leaves.
   * A new join to the same room waits for this.
   */
  end(): Promise<void> {
    if (this.ended) return this.ended;
    const { roomId } = this.options;
    this.ending = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.retryTimer);
    this.stopReading.abort();
    this.stopListening();
    const ended = (async () => {
      await this.started;
      // A check-in on its way names the call to leave.
      await this.joining;
      await this.captureSteps;
      await this.uploads;
      const { callId } = this;
      if (callId && this.status !== 'off') {
        await withTimeout(REQUEST_TIMEOUT_MS, (signal) => this.client.leave(callId, signal)).catch(
          () => undefined
        );
      }
      this.status = 'off';
    })();
    this.ended = ended;
    leaves.set(roomId, ended);
    void ended.finally(() => {
      if (leaves.get(roomId) === ended) leaves.delete(roomId);
    });
    return ended;
  }

  /**
   * Leaves at once as the page goes away, without the stretches still queued: nothing more is
   * captured or sent, and ending sends no second leave.
   */
  leaveNow(): void {
    const { callId } = this;
    if (callId && this.status !== 'off') this.client.leaveNow(callId);
    this.status = 'off';
    this.uploadGeneration += 1;
    void this.end();
  }

  /**
   * Ending, or off for good: an answer that arrives now hands nothing on, and no answer ever
   * brings the status back from off.
   */
  private get disposed(): boolean {
    return this.ending || this.status === 'off';
  }

  private setStatus(status: TranscriberStatus): void {
    if (this.status === status || this.status === 'off') return;
    this.status = status;
    if (!this.ending) this.options.onStatus(status, this.callId);
  }

  /**
   * Hands on the call MindRoom answered a join or Pause with. Listening follows its paused state
   * at once, before it starts or the controls follow.
   */
  private applyAnswer(call: TranscriptCall): void {
    if (this.disposed) return;
    this.answers += 1;
    this.lastAnswer = call;
    this.serverPaused = !!call.pausedBy;
    this.applyPaused();
    this.options.onUpdate({ type: 'call', call });
  }

  private heartbeat(): void {
    if (this.joining || this.ending || this.status === 'off') return;
    if (Date.now() < this.notBefore) return;
    const joining = this.join().finally(() => {
      if (this.joining === joining) this.joining = undefined;
    });
    this.joining = joining;
  }

  private async join(): Promise<void> {
    try {
      const call = await withTimeout(REQUEST_TIMEOUT_MS, (signal) =>
        this.client.join(this.options.roomId, signal)
      );
      if (this.status === 'off') return;
      this.answered = true;
      this.callId = call.id;
      this.applyAnswer(call);
      this.setStatus('transcribing');
      this.readLive();
    } catch (error) {
      if (isNotTranscribed(error)) this.turnOff();
      else if (error instanceof TranscriptionApiError && error.code === 'too-many-requests') {
        this.retryJoin(error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
      } else if (this.answered) this.setStatus('unavailable');
    }
    this.updateCapture();
  }

  /** A refused join is tried again after `Retry-After`, without a word; check-ins wait for it. */
  private retryJoin(wait: number): void {
    this.notBefore = Date.now() + wait;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.heartbeat(), wait);
  }

  /** This room is not transcribed: nothing more is captured or sent, not even a leave. */
  private turnOff(): void {
    this.setStatus('off');
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.retryTimer);
    this.stopReading.abort();
    this.updateCapture();
  }

  // Capture

  private wantedTrack(): MediaStreamTrack | undefined {
    return this.status === 'transcribing' && !this.ending ? this.track : undefined;
  }

  /**
   * Stops listening now, ahead of any capture step still queued, so nothing said after the end
   * is sent; the stretch in progress is still handed on.
   */
  private stopListening(): void {
    const current = this.capture;
    this.capture = undefined;
    const stopping = current?.capture.stop().catch(() => undefined);
    this.captureSteps = this.captureSteps
      .then(() => stopping)
      .then(() => this.applyCapture())
      .catch(() => undefined);
  }

  /** Starts, stops or switches the capture to what is wanted now, after the steps before. */
  private updateCapture(): void {
    if (this.status !== 'transcribing') this.uploadGeneration += 1;
    this.captureSteps = this.captureSteps.then(() => this.applyCapture()).catch(() => undefined);
  }

  private async applyCapture(): Promise<void> {
    const wanted = this.wantedTrack();
    if (this.capture?.track === wanted) return;
    const current = this.capture;
    this.capture = undefined;
    // Stopping hands on the stretch in progress: sent while transcribing, dropped otherwise.
    if (current) await current.capture.stop();
    if (!wanted) return;
    let capture: SpeechCapture;
    try {
      capture = await this.startCapture(wanted, (stretch) => this.queue(stretch));
    } catch {
      // The worklet could not load; the next change of microphone tries again.
      return;
    }
    capture.setPaused(this.paused);
    this.capture = { track: wanted, capture };
    // What is wanted may have changed while it started.
    if (this.wantedTrack() !== wanted) this.updateCapture();
  }

  // Uploads

  private queue(stretch: SpeechStretch): void {
    const { callId } = this;
    if (this.status !== 'transcribing' || !callId) return;
    const generation = this.uploadGeneration;
    // An upload that throws (a callback that failed) holds up neither the next ones nor the leave.
    this.uploads = this.uploads
      .then(() => (generation === this.uploadGeneration ? this.upload(callId, stretch) : undefined))
      .catch(() => undefined);
  }

  private async upload(callId: string, stretch: SpeechStretch): Promise<void> {
    const timeout = deadline(UPLOAD_TIMEOUT_MS);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const line = await this.client.speech(callId, stretch, timeout.signal);
          if (line && !this.disposed) this.options.onUpdate({ type: 'line', line });
          return;
        } catch (error) {
          if (timeout.signal.aborted) {
            // Given up after 30 seconds: only this stretch is lost, unless the call is ending,
            // when a server that hangs must not hold the leave (and a new join) any longer.
            if (this.ending) this.uploadGeneration += 1;
            return;
          }
          if (
            attempt === 0 &&
            error instanceof TranscriptionApiError &&
            error.code === 'too-many-requests'
          ) {
            const wait = Math.min(error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS);
            if (!(await sleep(wait, timeout.signal))) return;
            continue;
          }
          this.routeFailed(error);
          return;
        }
      }
    } finally {
      timeout.clear();
    }
  }

  private becomeUnavailable(): void {
    this.setStatus('unavailable');
    this.updateCapture();
  }

  /**
   * A call route that failed: not (or no longer) in the call, or the call is over, the check-in
   * finds out; MindRoom unreachable or failing, nothing is sent until a check-in is answered.
   */
  private routeFailed(error: unknown): void {
    if (isNotTranscribed(error)) this.heartbeat();
    else if (isUnavailable(error)) this.becomeUnavailable();
  }

  // The live call

  private readLive(): void {
    if (this.reading || this.ending) return;
    this.reading = true;
    // How many answers there were when the read on its way was sent.
    let answersAtRead = 0;
    const reads = {
      live: (...read: Parameters<TranscriptionClient['live']>) => {
        answersAtRead = this.answers;
        return this.client.live(...read);
      },
    };
    void pollLiveCall(
      reads,
      this.options.roomId,
      LIVE_READ_MS,
      this.stopReading.signal,
      (live) => {
        if (this.disposed) return;
        // A read sent before MindRoom's last answer may tell the call as it was before it: the
        // answer's call stays, and the read adds only its lines of that call.
        const answer = answersAtRead === this.answers ? undefined : this.lastAnswer;
        if (answer && live.call?.id !== answer.id) return;
        const shown = answer ? { ...live, call: answer } : live;
        this.serverPaused = !!shown.call?.pausedBy;
        this.applyPaused();
        this.options.onUpdate({ type: 'live', live: shown });
      },
      (error) => {
        // A read that fails counts as a failing route: nothing is sent until a check-in is answered.
        if (isUnavailable(error)) this.becomeUnavailable();
      }
    ).then((outcome) => {
      if (outcome === 'not-transcribed') this.turnOff();
    });
  }
}
