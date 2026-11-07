import type { IOpenIDToken } from 'matrix-js-sdk';
import {
  TranscriptionApiError,
  TranscriptionClient,
  isNotTranscribed,
  isUnavailable,
  type CallEvent,
  type TranscriptCall,
} from './api';
import { followCallEvents, sleep } from './liveCallStream';
import { startSpeechCapture, type SpeechCapture, type SpeechStretch } from './speechCapture';

/** How often this device checks in with the call; MindRoom counts it out after 60 s without. */
const HEARTBEAT_MS = 20_000;
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
/** A refused release of Pause is tried again after this long, doubling up to the most. */
const RELEASE_RETRY_MS = 1_000;
const RELEASE_RETRY_MAX_MS = 10_000;

/**
 * `joining` until MindRoom first answers (and silently while it does not); `transcribing`;
 * `unavailable` while it cannot be reached or fails after it once answered; `off` for good once
 * it says this room is not transcribed.
 */
export type TranscriberStatus = 'joining' | 'transcribing' | 'unavailable' | 'off';

export type CallTranscriberOptions = {
  roomId: string;
  /** The signed-in person, whose hold on Pause this device takes and lets go of. */
  userId: string;
  /** The room's MindRoom server. */
  apiUrl: string;
  /** A Matrix OpenID token bound to `apiUrl`. */
  getOpenIdToken: () => Promise<IOpenIDToken>;
  onStatus: (status: TranscriberStatus, callId: string | undefined) => void;
  /**
   * The room's live events, the line MindRoom answers each upload with, and the call it answers
   * each Pause with.
   */
  onEvent: (event: CallEvent) => void;
  /** MindRoom refused this device's hold on Pause: it is not held. */
  onHoldRefused?: () => void;
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
 * time, and follows the room's live events. MindRoom unreachable or failing: nothing is captured or
 * sent until a check-in is answered again. A room MindRoom does not transcribe (404 or 403): nothing
 * more at all.
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

  private readonly stream = new AbortController();

  private following = false;

  /** The microphone to listen to; none while muted. */
  private track?: MediaStreamTrack;

  private paused = false;

  /** This device holds Pause (it is pressed here). */
  private holding = false;

  /** MindRoom lists this person's hold, as it last said in the stream or a Pause answer. */
  private holdListed = false;

  /**
   * This device took a hold it has not let go of yet. Holds are per person, so MindRoom's list
   * cannot tell this device's from another of this person's devices; only this one is released.
   * It follows the latest Pause request this device sent: an answer to an earlier one, which may
   * come last, does not undo it.
   */
  private holdOwed = false;

  /** The Pause requests this device sent, counted; and whether the latest took the hold. */
  private pauseRequests = 0;

  private latestRequestHolds = false;

  /** A release of Pause on its way, tried again until MindRoom no longer lists the hold. */
  private releasing = false;

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

  /** Pauses capture at once, for this device's hold or anyone else's. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.capture?.capture.setPaused(paused);
  }

  /**
   * Takes or lets go of this person's hold on Pause in the joined call. A refused hold is
   * reported (`onHoldRefused`); a release is tried again until MindRoom no longer lists the hold.
   * Each answer is handed on as the call it describes. Only a hold this device took is let go of.
   */
  setHolding(holding: boolean): void {
    if (holding === this.holding) return;
    this.holding = holding;
    if (holding) void this.takeHold();
    else this.letGo();
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
    this.stream.abort();
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

  private setStatus(status: TranscriberStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (!this.ending) this.options.onStatus(status, this.callId);
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
      this.setStatus('transcribing');
      this.followEvents();
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
    this.stream.abort();
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
    this.uploads = this.uploads.then(() =>
      generation === this.uploadGeneration ? this.upload(callId, stretch) : undefined
    );
  }

  private async upload(callId: string, stretch: SpeechStretch): Promise<void> {
    const timeout = deadline(UPLOAD_TIMEOUT_MS);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const line = await this.client.speech(callId, stretch, timeout.signal);
          if (line && !this.ending) this.options.onEvent({ type: 'line', line });
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
          // Not (or no longer) in the call, or the call is over: the check-in finds out.
          if (isNotTranscribed(error)) this.heartbeat();
          else if (isUnavailable(error)) this.becomeUnavailable();
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

  // Pause

  /** Counts a Pause request as the latest this device sent, and answers its number. */
  private nextPauseRequest(holding: boolean): number {
    this.pauseRequests += 1;
    this.latestRequestHolds = holding;
    return this.pauseRequests;
  }

  private async takeHold(): Promise<void> {
    const { callId } = this;
    // Not in a call MindRoom answered for (or on the way out): there is nothing to hold.
    if (!callId || this.status !== 'transcribing' || this.ending) {
      this.refuseHold();
      return;
    }
    const request = this.nextPauseRequest(true);
    this.holdOwed = true;
    let answer: TranscriptCall;
    try {
      answer = await withTimeout(REQUEST_TIMEOUT_MS, (signal) =>
        this.client.pause(callId, true, signal)
      );
    } catch (error) {
      // Refused: nothing was taken. A server error or no answer: it may have been, so it is owed
      // and, as it shows as not held, let go of.
      const refused =
        error instanceof TranscriptionApiError && error.status < 500 && error.status > 0;
      if (refused && request === this.pauseRequests) this.holdOwed = false;
      if (this.holding) this.refuseHold();
      if (!refused) this.letGo();
      return;
    }
    // A hold it lists is this device's, also one taken after a release that answered first;
    // one it does not list counts only from the latest request.
    const listed = answer.holds.includes(this.options.userId);
    if (listed) this.holdOwed = true;
    else if (request === this.pauseRequests) this.holdOwed = false;
    this.onPauseAnswer(answer);
  }

  private refuseHold(): void {
    this.holding = false;
    this.options.onHoldRefused?.();
  }

  /**
   * Lets go of the hold this device took, trying again after a refusal (each time twice as long)
   * until MindRoom no longer lists it, Pause is pressed again, or the call ends here, as leaving
   * lets go. A hold taken and let go of again while a release was on its way is let go of next.
   */
  private letGo(): void {
    if (this.releasing || !this.holdOwed) return;
    this.releasing = true;
    // Until MindRoom says otherwise, the hold may be there.
    this.holdListed = true;
    void (async () => {
      let wait = RELEASE_RETRY_MS;
      try {
        while (this.holdOwed && !this.holding) {
          const { callId } = this;
          if (!callId || this.ending || this.status === 'off') return;
          if (!(await this.release(callId))) {
            if (!this.holdListed || !(await sleep(wait, this.stream.signal))) return;
            wait = Math.min(wait * 2, RELEASE_RETRY_MAX_MS);
          }
        }
      } finally {
        this.releasing = false;
      }
    })();
  }

  /** Sends one release; answers whether MindRoom answered it. */
  private async release(callId: string): Promise<boolean> {
    const request = this.nextPauseRequest(false);
    let answer: TranscriptCall;
    try {
      answer = await withTimeout(REQUEST_TIMEOUT_MS, (signal) =>
        this.client.pause(callId, false, signal)
      );
    } catch {
      // Refused or unanswered: what MindRoom last said decides.
      return false;
    }
    if (request === this.pauseRequests) this.holdOwed = false;
    this.onPauseAnswer(answer);
    // Pressed again meanwhile and the hold is gone: it is taken again.
    if (this.holding && !answer.holds.includes(this.options.userId)) void this.takeHold();
    return true;
  }

  /** MindRoom's answer to Pause is the call as it is now, holds and all. */
  private onPauseAnswer(call: TranscriptCall): void {
    if (this.ending) return;
    this.options.onEvent({ type: 'call', call });
    this.noteHolds(call);
  }

  /**
   * Whether MindRoom lists this person's hold in the joined call, as its stream or a Pause answer
   * says (never a check-in). A hold this device took that it lists while it is not held here is
   * let go of. One it does not list after this device last asked to let go is owed nothing more.
   */
  private noteHolds(call: TranscriptCall): void {
    if (call.id !== this.callId) return;
    this.holdListed = call.holds.includes(this.options.userId);
    if (!this.holdListed && !this.latestRequestHolds) this.holdOwed = false;
    if (this.holdListed && !this.holding) this.letGo();
  }

  // Live events

  private followEvents(): void {
    if (this.following) return;
    this.following = true;
    void followCallEvents(this.client, this.options.roomId, this.stream.signal, (event) =>
      this.onStreamEvent(event)
    ).then((outcome) => {
      if (outcome === 'not-transcribed') this.turnOff();
    });
  }

  private onStreamEvent(event: CallEvent): void {
    if (this.ending) return;
    this.options.onEvent(event);
    if (event.type === 'call') this.noteHolds(event.call);
    if (event.type === 'ready' && event.live.call) this.noteHolds(event.live.call);
    // The call this device is in ended without it: it checks in for the call now.
    if (event.type === 'ended' && event.callId === this.callId) this.heartbeat();
  }
}
