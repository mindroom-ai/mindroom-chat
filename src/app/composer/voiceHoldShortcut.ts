import { useEffect, useRef, useState } from 'react';
import { useStore } from 'jotai';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';
import { openOverlay } from '../shortcuts/shortcutDom';
import { isComposingKey } from '../shortcuts/shortcuts';
import {
  VOICE_HOLD_MS,
  createVoiceHold,
  type VoiceHold,
  type VoiceHoldTarget,
} from '../shortcuts/voiceHold';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';

/** A composer that records voice: its root element, whether it writes a thread, and its actions. */
export type VoiceComposer = VoiceHoldTarget & { root: () => HTMLElement | null; thread: boolean };

/** One mounted composer: `current` is its latest render, `target` acts on that while mounted. */
type Entry = { current?: VoiceComposer; target: VoiceHoldTarget };

// In mount order, like the shortcut handlers.
const entries = new Set<Entry>();

// A press pins an entry's target, so each call reads the composer as it is then, and one that went
// away does nothing.
const createEntry = (): Entry => {
  const live = () => (entries.has(entry) ? entry.current : undefined);
  const entry: Entry = {
    target: {
      active: () => live()?.active() ?? false,
      phase: () => live()?.phase() ?? 'none',
      hasContent: () => live()?.hasContent() ?? false,
      start: () => live()?.start() ?? false,
      send: () => live()?.send(),
      focus: () => live()?.focus(),
    },
  };
  return entry;
};

/**
 * Lets the voice key act in the calling composer while it is mounted; `undefined` for one that
 * records no voice (a fork draft's).
 */
export const useVoiceComposer = (composer: VoiceComposer | undefined): void => {
  const [entry] = useState(createEntry);
  entry.current = composer;
  const enabled = composer !== undefined;
  useEffect(() => {
    if (!enabled) return undefined;
    entries.add(entry);
    return () => {
      entries.delete(entry);
    };
  }, [enabled, entry]);
};

/**
 * The composer a press of the voice key acts in. One whose recorder is open, or that offers a
 * failed recording, is the only one that may (opening a recorder elsewhere would end its
 * recording); else the focused composer, else the open thread's, else the room's.
 */
export const resolveVoiceComposer = (
  focused: Element | null = document.activeElement
): VoiceHoldTarget | undefined => {
  const live = [...entries].reverse().filter((entry) => entry.current);
  return (
    live.find((entry) => entry.current?.active()) ??
    live.find((entry) => !!focused && !!entry.current?.root()?.contains(focused)) ??
    live.find((entry) => entry.current?.thread) ??
    live[0]
  )?.target;
};

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'CapsLock', 'Fn']);

/**
 * The voice key: right ⌥ (right Alt elsewhere, also as AltGraph) pressed alone records a voice
 * message in the composer `resolveVoiceComposer` finds (`createVoiceHold`). Not over a dialog,
 * menu or popover, for the Computer screen, with another key held, in an input method, or with the
 * `voiceHoldShortcut` setting off. Only the releases it acts on are cancelled, so the key keeps
 * its meaning everywhere else.
 */
export const useVoiceHoldShortcut = (enabled: boolean): void => {
  const store = useStore();
  // Read live: switched off, the key arms nothing, and a press under way ends as interrupted. The
  // held keys stay tracked meanwhile, so a key already down when it comes back on still counts.
  const enabledRef = useRef(enabled);
  const holdRef = useRef<VoiceHold>();
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) holdRef.current?.interrupt();
  }, [enabled]);

  useEffect(() => {
    const hold = createVoiceHold({
      delayMs: VOICE_HOLD_MS,
      schedule: (run, ms) => {
        const timer = window.setTimeout(run, ms);
        return () => window.clearTimeout(timer);
      },
      resolve: () => resolveVoiceComposer(),
      sendPending: () => store.get(voiceAutoSendPendingAtom),
    });
    holdRef.current = hold;
    // Keys other than modifiers that are down now, as a press of A then right ⌥ is no press alone.
    // Left ⌥ counts too: `altKey` cannot tell right ⌥ alone from both. So do mouse buttons down.
    const held = new Set<string>();
    const pointers = new Set<number>();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key) || event.code === 'AltLeft') held.add(event.code);
      const alone =
        enabledRef.current &&
        event.code === 'AltRight' &&
        held.size === 0 &&
        pointers.size === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !isComposingKey(event) &&
        !computerOwnsKeyboardEvent(event) &&
        !computerOwnsKeyboardFocus() &&
        openOverlay() === 'none';
      if (alone) hold.keyDown(event.repeat);
      else hold.interrupt();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // macOS drops the release of a key pressed with ⌘, but not of a modifier.
      if (event.key !== 'Meta') held.delete(event.code);
      else
        held.forEach((code) => {
          if (code !== 'AltLeft') held.delete(code);
        });
      if (event.code === 'AltRight' && hold.keyUp()) event.preventDefault();
    };
    const interrupt = () => hold.interrupt();
    const onPointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      hold.interrupt();
    };
    const onPointerUp = (event: PointerEvent) => pointers.delete(event.pointerId);
    const onBlur = () => {
      held.clear();
      pointers.clear();
      hold.interrupt();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') onBlur();
    };

    // Capture: a widget that stops a key on its way up still cancels the press.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('wheel', interrupt, { capture: true });
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      hold.interrupt();
    };
  }, [store]);
};
