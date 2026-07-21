import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_END_HOST_DEADLINE_MS,
  CallTermination,
  CallTerminationReason,
  isForcedTermination,
} from './CallTermination';

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
};

const deferred = (): Deferred => {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = () =>
  new Promise<void>((resolve) => {
    process.nextTick(resolve);
  });

type Harness = {
  termination: CallTermination;
  hangupRequest: Deferred;
  sendHangup: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  abandon: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  reasons: () => CallTerminationReason[];
};

const createHarness = (options?: { joined?: boolean }): Harness => {
  const hangupRequest = deferred();
  const sendHangup = vi.fn(() => hangupRequest.promise);
  const finalize = vi.fn();
  const abandon = vi.fn();
  const log = vi.fn();
  const termination = new CallTermination({
    isJoined: () => options?.joined ?? true,
    sendHangup,
    finalize,
    abandon,
    log,
  });
  return {
    termination,
    hangupRequest,
    sendHangup,
    finalize,
    abandon,
    log,
    reasons: () => finalize.mock.calls.map(([reason]) => reason as CallTerminationReason),
  };
};

describe('CallTermination', () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    unhandledRejections.length = 0;
    process.on('unhandledRejection', onUnhandledRejection);
  });

  afterEach(async () => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    await flushMicrotasks();
    process.off('unhandledRejection', onUnhandledRejection);
    expect(unhandledRejections).toEqual([]);
  });

  it('stays ending on a never-settling widget request and forces exactly once at the deadline', () => {
    const h = createHarness();

    h.termination.endCall();

    expect(h.sendHangup).toHaveBeenCalledTimes(1);
    expect(h.termination.isEnding()).toBe(true);

    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS - 1);
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.termination.isEnding()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(h.reasons()).toEqual(['deadline']);
    expect(h.termination.isEnding()).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('a synchronously throwing hangup request forces exactly one local teardown', () => {
    // A stopped transport throws from send() instead of returning a
    // rejecting promise; the branch must finalize once, cancel the
    // just-armed deadline, and leave no uncaught error behind.
    const h = createHarness();
    h.sendHangup.mockImplementationOnce(() => {
      throw new Error('transport stopped');
    });

    h.termination.endCall();

    expect(h.reasons()).toEqual(['transport-rejected']);
    expect(h.termination.isEnding()).toBe(false);
    expect(h.log).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS * 2);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('treats the transport acknowledgement as delivery only, never as teardown', async () => {
    const h = createHarness();

    h.termination.endCall();
    h.hangupRequest.resolve({});
    await flushMicrotasks();

    // Element Call replies before its leave transition; the deadline must
    // stay armed until a from-widget Close arrives.
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.termination.isEnding()).toBe(true);

    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);
    expect(h.reasons()).toEqual(['deadline']);
  });

  it('marks progress on from-widget Hangup but still forces at the original deadline', () => {
    const h = createHarness();

    h.termination.endCall();
    vi.advanceTimersByTime(3000);
    h.termination.handleWidgetHangup();

    expect(h.finalize).not.toHaveBeenCalled();

    // The original deadline (armed at endCall) fires 1000ms later; Hangup
    // must not re-arm it.
    vi.advanceTimersByTime(1000);
    expect(h.reasons()).toEqual(['deadline']);
    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('finalizes once through the healthy path on Hangup followed by Close', () => {
    const h = createHarness();

    h.termination.endCall();
    h.termination.handleWidgetHangup();
    h.termination.handleWidgetClose();

    expect(h.reasons()).toEqual(['widget-close']);
    expect(h.termination.isEnding()).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('consumes an immediate transport rejection and forces local teardown once', async () => {
    const h = createHarness();

    h.termination.endCall();
    h.hangupRequest.reject(new Error('Request timed out'));
    await flushMicrotasks();

    expect(h.reasons()).toEqual(['transport-rejected']);
    expect(h.log).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('consumes a late transport rejection after forced teardown without another state change', async () => {
    const h = createHarness();

    h.termination.endCall();
    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);
    expect(h.reasons()).toEqual(['deadline']);
    const finalizeCallsAfterDeadline = h.finalize.mock.calls.length;
    const logCallsAfterDeadline = h.log.mock.calls.length;

    // The disposed transport rejects the still-pending request afterwards.
    h.hangupRequest.reject(new Error('Transport stopped'));
    await flushMicrotasks();

    expect(h.finalize.mock.calls.length).toBe(finalizeCallsAfterDeadline);
    expect(h.log.mock.calls.length).toBe(logCallsAfterDeadline);
  });

  it('sends one widget request and runs one finalizer for repeated End presses on both surfaces', () => {
    const h = createHarness();

    // In-room End and status-bar End share the coordinator.
    h.termination.endCall();
    h.termination.endCall();
    vi.advanceTimersByTime(1000);
    h.termination.endCall();

    expect(h.sendHangup).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate Hangup and Close signals after finalization', () => {
    const h = createHarness();

    h.termination.endCall();
    h.termination.handleWidgetHangup();
    h.termination.handleWidgetHangup();
    h.termination.handleWidgetClose();
    h.termination.handleWidgetClose();
    h.termination.endCall();

    expect(h.sendHangup).toHaveBeenCalledTimes(1);
    expect(h.reasons()).toEqual(['widget-close']);
  });

  it('never runs stale callbacks from a replaced embed', async () => {
    const h = createHarness();

    h.termination.endCall();
    h.termination.dispose();

    h.termination.handleWidgetHangup();
    h.termination.handleWidgetClose();
    h.termination.endCall();
    h.hangupRequest.reject(new Error('Transport stopped'));
    await flushMicrotasks();
    vi.advanceTimersByTime(60_000);

    expect(h.sendHangup).toHaveBeenCalledTimes(1);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('hands an in-flight ending to abandon exactly once when disposed mid-ending', () => {
    const h = createHarness();

    h.termination.endCall();
    h.termination.dispose();
    h.termination.dispose();

    expect(h.abandon).toHaveBeenCalledTimes(1);
    expect(h.finalize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(h.abandon).toHaveBeenCalledTimes(1);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('hands a widget-initiated in-flight ending to abandon on disposal', () => {
    const h = createHarness();

    h.termination.handleWidgetHangup();
    h.termination.dispose();

    expect(h.abandon).toHaveBeenCalledTimes(1);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('hands an idle never-finalized coordinator to abandon exactly once on disposal', () => {
    // Replacing an idle embed (e.g. answering an incoming call in another
    // room while an unjoined call sits open) leaves the same network
    // obligations behind as a replacement mid-ending: residual RTC
    // membership and a possible ephemeral agent room. Only a finalized
    // teardown — which started its own cleanup — may skip abandon.
    const idle = createHarness();
    idle.termination.dispose();
    idle.termination.dispose();
    expect(idle.abandon).toHaveBeenCalledTimes(1);
    expect(idle.finalize).not.toHaveBeenCalled();
  });

  it('never abandons when disposed after finalization', () => {
    const done = createHarness();
    done.termination.endCall();
    done.termination.handleWidgetClose();
    done.termination.dispose();
    expect(done.reasons()).toEqual(['widget-close']);
    expect(done.abandon).not.toHaveBeenCalled();
  });

  it('returns to a retryable idle state when the host finalizer throws', async () => {
    const h = createHarness();
    h.finalize.mockImplementationOnce(() => {
      throw new Error('local teardown failed');
    });

    h.termination.endCall();
    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);

    // The failed finalize must not latch: the embed may still be mounted,
    // so End has to stay available instead of becoming a permanent no-op.
    expect(h.reasons()).toEqual(['deadline']);
    expect(h.termination.isEnding()).toBe(false);
    expect(h.log).toHaveBeenCalledTimes(2); // deadline diagnostic + failure

    h.termination.endCall();
    expect(h.sendHangup).toHaveBeenCalledTimes(2);
    expect(h.termination.isEnding()).toBe(true);

    h.termination.handleWidgetClose();
    expect(h.reasons()).toEqual(['deadline', 'widget-close']);
    expect(h.termination.isEnding()).toBe(false);
    await flushMicrotasks();
  });

  it('reports not-ending once disposed mid-ending', () => {
    const h = createHarness();

    h.termination.endCall();
    expect(h.termination.isEnding()).toBe(true);

    h.termination.dispose();
    // A consumer still holding the disposed coordinator must never read a
    // stale in-flight ending from it.
    expect(h.termination.isEnding()).toBe(false);
  });

  it('finalizes a not-yet-joined call locally without a widget request', () => {
    const h = createHarness({ joined: false });

    h.termination.endCall();

    expect(h.sendHangup).not.toHaveBeenCalled();
    expect(h.reasons()).toEqual(['not-joined']);

    vi.advanceTimersByTime(60_000);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('bounds a widget-initiated Hangup with the same deadline while waiting for Close', () => {
    const h = createHarness();

    h.termination.handleWidgetHangup();

    expect(h.sendHangup).not.toHaveBeenCalled();
    expect(h.termination.isEnding()).toBe(true);

    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS - 1);
    expect(h.finalize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.reasons()).toEqual(['deadline']);
  });

  it('finalizes a widget-initiated Hangup through the healthy path when Close follows', () => {
    const h = createHarness();

    h.termination.handleWidgetHangup();
    vi.advanceTimersByTime(1000);
    h.termination.handleWidgetClose();

    expect(h.reasons()).toEqual(['widget-close']);
    vi.advanceTimersByTime(60_000);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when the shared ending state changes', () => {
    const h = createHarness();
    const seen: boolean[] = [];
    h.termination.subscribe(() => seen.push(h.termination.isEnding()));

    h.termination.endCall();
    vi.advanceTimersByTime(CALL_END_HOST_DEADLINE_MS);

    expect(seen).toEqual([true, false]);
  });
});

describe('isForcedTermination', () => {
  it('treats every outcome except the healthy widget Close as forced', () => {
    expect(isForcedTermination('widget-close')).toBe(false);
    expect(isForcedTermination('transport-rejected')).toBe(true);
    expect(isForcedTermination('deadline')).toBe(true);
    expect(isForcedTermination('not-joined')).toBe(true);
  });
});
