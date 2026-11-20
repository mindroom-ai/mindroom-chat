/**
 * Right ⌥ (right Alt elsewhere) on its own records a voice message. A tap starts a hands-free
 * recording; holding it past the threshold records while held and sends on release
 * (push-to-talk). With a recording already running, a press and release sends it. Anything that
 * makes the press part of something else (another key, as in ⌥- for a dash; a click; the wheel;
 * leaving the window) cancels it before the threshold, and during push-to-talk keeps the
 * recording running without sending it (it latches).
 */
export const VOICE_HOLD_MS = 300;

/** `none` without an open recorder; `other` while it processes, sends or holds a failed one. */
export type VoiceTargetPhase = 'none' | 'requesting' | 'recording' | 'paused' | 'other';

/** The composer a press acts in, pinned from the key going down until it comes up. */
export type VoiceHoldTarget = {
  /** A recorder is open here, or a failed recording waits here. */
  active: () => boolean;
  phase: () => VoiceTargetPhase;
  /** Text or staged attachments, which a send would take along. */
  hasContent: () => boolean;
  /** Opens the recorder as the mic button does; false when its guards refuse. */
  start: () => boolean;
  /** Sends the recording through the composer's send path (Enter). */
  send: () => void;
  focus: () => void;
};

export type VoiceHoldState = 'idle' | 'armed' | 'talking' | 'ignored';

export type VoiceHoldOptions = {
  delayMs: number;
  /** Runs `run` after `ms`; returns a function that stops it. */
  schedule: (run: () => void, ms: number) => () => void;
  /** The composer the press acts in, if any may. */
  resolve: () => VoiceHoldTarget | undefined;
  /** A voice message is on its way (`voiceAutoSendPendingAtom`). */
  sendPending: () => boolean;
};

export type VoiceHold = {
  readonly state: VoiceHoldState;
  /** The key went down with no other key or modifier; `repeat` for the key's auto-repeat. */
  keyDown: (repeat: boolean) => void;
  /** Any other key, a mouse button, the wheel, a blur or the page hiding. */
  interrupt: () => void;
  /** The key came up. True when the press acted, so the event is the app's. */
  keyUp: () => boolean;
};

const sendable = (target: VoiceHoldTarget, phases: readonly VoiceTargetPhase[]): boolean =>
  phases.includes(target.phase()) && !target.hasContent();

export const createVoiceHold = ({
  delayMs,
  schedule,
  resolve,
  sendPending,
}: VoiceHoldOptions): VoiceHold => {
  let state: VoiceHoldState = 'idle';
  let target: VoiceHoldTarget | undefined;
  // Whether the press began with a recording running: it sends that one instead of starting.
  let sends = false;
  let stopTimer: (() => void) | undefined;

  const moveTo = (next: VoiceHoldState) => {
    state = next;
    if (next !== 'armed') {
      stopTimer?.();
      stopTimer = undefined;
    }
    if (next === 'idle') target = undefined;
  };

  return {
    get state() {
      return state;
    },
    keyDown(repeat) {
      if (state === 'armed' || state === 'talking') return;
      // Auto-repeat of a press that was cancelled, or began unseen, stays ignored.
      if (repeat) {
        moveTo('ignored');
        return;
      }
      target = sendPending() ? undefined : resolve();
      if (!target) {
        moveTo('ignored');
        return;
      }
      sends = target.active();
      moveTo('armed');
      if (sends) return;
      stopTimer = schedule(() => {
        stopTimer = undefined;
        if (state !== 'armed') return;
        moveTo(!sendPending() && target?.start() ? 'talking' : 'ignored');
      }, delayMs);
    },
    interrupt() {
      if (state !== 'idle') moveTo('ignored');
    },
    keyUp() {
      const was = state;
      const pressed = target;
      moveTo('idle');
      if (!pressed || sendPending()) return false;
      if (was === 'armed' && !sends) return pressed.start();
      if (was === 'armed') {
        if (sendable(pressed, ['recording', 'paused'])) pressed.send();
        else pressed.focus();
        return true;
      }
      if (was === 'talking') {
        // A recording still waiting for the microphone, or one that would take text along,
        // keeps running (latches).
        if (sendable(pressed, ['recording'])) pressed.send();
        return true;
      }
      return false;
    },
  };
};
