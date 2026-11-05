/**
 * Holding ⌘ (Ctrl elsewhere) on its own for a moment shows the shortcut hints. Anything that
 * makes the press part of something else (another key, as in ⌘C; a click, as in Ctrl+click;
 * the wheel; leaving the window) cancels it until the key comes up again, so copy, paste and
 * modified clicks never show hints.
 */
export type HintHoldState = 'idle' | 'holding' | 'shown' | 'cancelled';

export type HintHoldOptions = {
  delayMs: number;
  /** Runs `run` after `ms`; returns a function that stops it. */
  schedule: (run: () => void, ms: number) => () => void;
  /** Whether hints may show now (no selection, no other dialog, Computer not focused). */
  canShow: () => boolean;
  onChange: (shown: boolean) => void;
};

export type HintHold = {
  readonly state: HintHoldState;
  /** The modifier went down with no other key or modifier; `repeat` for the key's auto-repeat. */
  modifierDown: (repeat: boolean) => void;
  /** Any other key, a mouse button, the wheel, a blur or focus in the Computer screen. */
  interrupt: () => void;
  /** The modifier came up. */
  modifierUp: () => void;
};

export const createHintHold = ({
  delayMs,
  schedule,
  canShow,
  onChange,
}: HintHoldOptions): HintHold => {
  let state: HintHoldState = 'idle';
  let stopTimer: (() => void) | undefined;

  const moveTo = (next: HintHoldState) => {
    const wasShown = state === 'shown';
    state = next;
    if (next !== 'holding') {
      stopTimer?.();
      stopTimer = undefined;
    }
    if (wasShown !== (next === 'shown')) onChange(next === 'shown');
  };

  return {
    get state() {
      return state;
    },
    modifierDown(repeat) {
      if (state === 'holding' || state === 'shown') return;
      // Auto-repeat of a press that was already cancelled stays cancelled; a new press starts over.
      if (state === 'cancelled' && repeat) return;
      if (!canShow()) {
        moveTo('cancelled');
        return;
      }
      moveTo('holding');
      stopTimer = schedule(() => {
        stopTimer = undefined;
        if (state === 'holding') moveTo(canShow() ? 'shown' : 'cancelled');
      }, delayMs);
    },
    interrupt() {
      if (state !== 'idle') moveTo('cancelled');
    },
    modifierUp() {
      moveTo('idle');
    },
  };
};
