/**
 * Host-owned End-call coordinator (CINNY-129).
 *
 * `im.vector.hangup` is only a request to the embedded Element Call iframe.
 * The widget transport acknowledgement proves delivery, not teardown: a
 * wedged iframe (e.g. after long backgrounding) never emits the from-widget
 * Hangup/Close signals, and the transport rejects each request after ten
 * seconds. The host therefore owns one bounded deadline after which local
 * teardown proceeds without the widget.
 */

/**
 * Budget for Element Call's healthy leave: widget round-trip, the ~0.9s
 * leave sound, the 1000ms MatrixRTC leave bound, and browser scheduling —
 * while staying well under the transport's 10s rejection.
 */
export const CALL_END_HOST_DEADLINE_MS = 4000;

export type CallTerminationReason =
  /** Element Call sent from-widget Close: it completed its own leave path. */
  | 'widget-close'
  /** The parent-to-widget hangup request rejected (timeout/transport stop). */
  | 'transport-rejected'
  /** No from-widget Close before the host deadline expired. */
  | 'deadline'
  /** End pressed before the call was ever joined; nothing to wind down. */
  | 'not-joined';

/**
 * Forced terminations bypass Element Call's own cleanup, so the host must
 * scrub this device's MatrixRTC membership afterwards. A healthy Close means
 * Element Call already owns and completed the membership leave.
 */
export const isForcedTermination = (reason: CallTerminationReason): boolean =>
  reason !== 'widget-close';

export type CallTerminationDeps = {
  /** Whether the embed ever joined the call. */
  isJoined: () => boolean;
  /** Send the parent-to-widget `im.vector.hangup` request. */
  sendHangup: () => Promise<unknown>;
  /**
   * Perform local teardown: verify the embed identity is still current,
   * clear the call embed atom (disposing iframe, media and controls) and
   * start detached network cleanup. Must not await network operations
   * before disposing, and must be idempotent: a throwing finalizer returns
   * the coordinator to a retryable state, so a user retry, a late transport
   * rejection, or a late widget Close re-invokes it.
   */
  finalize: (reason: CallTerminationReason) => void;
  /**
   * Start the detached network-cleanup portion for a call whose in-flight
   * ending was abandoned (the embed was replaced or removed before the
   * finalizer could run). Local disposal already happened elsewhere, so this
   * must not touch the embed atom.
   */
  abandon?: () => void;
  deadlineMs?: number;
  /** One-line diagnostics; must never throw. */
  log?: (message: string, cause?: unknown) => void;
};

const defaultLog = (message: string, cause?: unknown): void => {
  if (cause === undefined) console.warn(`[call-termination] ${message}`);
  else console.warn(`[call-termination] ${message}`, cause);
};

export class CallTermination {
  private readonly deps: CallTerminationDeps;

  private readonly deadlineMs: number;

  private readonly log: (message: string, cause?: unknown) => void;

  private ending = false;

  private finalized = false;

  private disposed = false;

  private ackReceived = false;

  private hangupSignalReceived = false;

  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly listeners = new Set<() => void>();

  constructor(deps: CallTerminationDeps) {
    this.deps = deps;
    this.deadlineMs = deps.deadlineMs ?? CALL_END_HOST_DEADLINE_MS;
    this.log = deps.log ?? defaultLog;
  }

  public isEnding(): boolean {
    return this.ending && !this.finalized;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * End the call from either host surface. Repeated calls against the same
   * in-flight termination are no-ops.
   */
  public endCall(): void {
    if (this.disposed || this.finalized || this.ending) return;
    if (!this.deps.isJoined()) {
      // There is no widget call session to wind down; requesting a hangup
      // would wait on an iframe that never joined.
      this.finalize('not-joined');
      return;
    }

    this.beginEnding();
    this.armDeadline();

    let request: Promise<unknown>;
    try {
      request = Promise.resolve(this.deps.sendHangup());
    } catch (error) {
      this.log('hangup request threw synchronously; forcing local teardown', error);
      this.finalize('transport-rejected');
      return;
    }
    request.then(
      () => {
        // Element Call replies to the hangup request before it starts its
        // leave transition, so the acknowledgement must not finalize or
        // cancel the host deadline.
        this.ackReceived = true;
      },
      (error) => {
        // Late "Request timed out" / "Transport stopped" rejections after
        // teardown are expected; consume them without another state change.
        if (this.disposed || this.finalized) return;
        this.log('hangup request failed; forcing local teardown', error);
        this.finalize('transport-rejected');
      }
    );
  }

  /**
   * From-widget Hangup: Element Call started its leave transition. Marks
   * progress only — Close (or the deadline) completes the teardown.
   */
  public handleWidgetHangup(): void {
    if (this.disposed || this.finalized) return;
    this.hangupSignalReceived = true;
    if (!this.ending) {
      // Widget-initiated hangup: enter the same bounded ending state and
      // wait for Close instead of disposing the iframe mid-transition.
      this.beginEnding();
      this.armDeadline();
    }
  }

  /** From-widget Close: the terminal healthy teardown signal. */
  public handleWidgetClose(): void {
    if (this.disposed || this.finalized) return;
    this.finalize('widget-close');
  }

  /**
   * Detach this coordinator from a replaced or removed embed. Stale
   * callbacks (widget signals, deadline, late settlements) become no-ops so
   * they can never dispose a newer embed. Unless this call already
   * finalized (which started its own cleanup), its network obligations are
   * handed to `deps.abandon`: an embed replaced while still idle — e.g.
   * answering an incoming call in another room — leaves the same residual
   * RTC membership and ephemeral agent room behind as one replaced
   * mid-ending, and they must still be cleaned exactly once. A same-room
   * successor's generation claim fences obsolete work inside the abandon
   * path itself.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDeadline();
    this.listeners.clear();
    if (!this.finalized) {
      this.log('call embed detached without finalizing; starting its detached cleanup');
      try {
        this.deps.abandon?.();
      } catch (error) {
        this.log('abandoned-call cleanup failed to start', error);
      }
    }
    // A disposed coordinator must never report a stale in-flight ending to
    // a consumer still holding a reference to it.
    this.ending = false;
  }

  private beginEnding(): void {
    this.ending = true;
    this.emit();
  }

  private armDeadline(): void {
    if (this.deadlineTimer !== undefined) return;
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = undefined;
      if (this.disposed || this.finalized) return;
      this.log(
        `no widget Close within ${this.deadlineMs}ms; forcing local teardown` +
          ` (ack=${this.ackReceived}, hangupSignal=${this.hangupSignalReceived})`
      );
      this.finalize('deadline');
    }, this.deadlineMs);
  }

  private clearDeadline(): void {
    if (this.deadlineTimer === undefined) return;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
  }

  private finalize(reason: CallTerminationReason): void {
    if (this.finalized) return;
    // Set before invoking the host finalizer so the re-entrant teardown
    // chain (atom clear → CallEmbed.dispose → transport stop → pending
    // hangup rejection) is absorbed by the guards above.
    this.finalized = true;
    this.ending = false;
    this.clearDeadline();
    try {
      this.deps.finalize(reason);
    } catch (error) {
      // If the host finalizer failed, the embed may still be mounted;
      // keeping `finalized` latched would leave every End surface
      // permanently inert. Return to a retryable idle state instead.
      this.finalized = false;
      this.log('local call finalizer failed; End stays available for retry', error);
    }
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A broken subscriber must not break termination.
      }
    });
  }
}
