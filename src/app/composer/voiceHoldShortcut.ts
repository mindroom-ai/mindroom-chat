import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';
import { openOverlay } from '../shortcuts/shortcutDom';
import { isComposingKey } from '../shortcuts/shortcuts';
import { VOICE_HOLD_MS, createVoiceHold, type VoiceHoldTarget } from '../shortcuts/voiceHold';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';

/** A composer that records voice: its root element, whether it writes a thread, and its actions. */
export type VoiceComposer = {
  root: () => HTMLElement | null;
  thread: boolean;
  target: VoiceHoldTarget;
};

type ComposerRef = { current: VoiceComposer };

// In mount order, like the shortcut handlers.
const composers: ComposerRef[] = [];

/**
 * Lets the voice key act in the calling composer while it is mounted; `undefined` for one that
 * records no voice (a fork draft's).
 */
export const useVoiceComposer = (composer: VoiceComposer | undefined): void => {
  const ref = useRef(composer);
  ref.current = composer;
  const enabled = composer !== undefined;
  useEffect(() => {
    if (!enabled) return undefined;
    const entry: ComposerRef = {
      get current() {
        // Registered only while enabled, so the latest render's composer is there.
        return ref.current as VoiceComposer;
      },
    };
    composers.push(entry);
    return () => {
      const index = composers.indexOf(entry);
      if (index >= 0) composers.splice(index, 1);
    };
  }, [enabled]);
};

/**
 * The composer a press of the voice key acts in. One whose recorder is open, or that offers a
 * failed recording, is the only one that may (opening a recorder elsewhere would end its
 * recording); else the focused composer, else the open thread's, else the room's.
 */
export const resolveVoiceComposer = (
  focused: Element | null = document.activeElement
): VoiceHoldTarget | undefined => {
  const live = composers.map((entry) => entry.current).reverse();
  return (
    live.find((composer) => composer.target.active()) ??
    live.find((composer) => !!focused && !!composer.root()?.contains(focused)) ??
    live.find((composer) => composer.thread) ??
    live.find((composer) => !composer.thread)
  )?.target;
};

/** Right ⌥ (right Alt) with no other modifier, which an input method is not composing with. */
const isVoiceKeyAlone = (event: KeyboardEvent): boolean =>
  event.code === 'AltRight' &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  !isComposingKey(event);

/**
 * The voice key: right ⌥ (right Alt elsewhere, also as AltGraph) on its own records a voice
 * message in the composer `resolveVoiceComposer` finds (`createVoiceHold`). It does nothing over
 * a dialog, menu or popover, or for the Computer screen. Only the releases it acts on are
 * cancelled, so the key keeps its meaning everywhere else.
 */
export const useVoiceHoldShortcut = (): void => {
  const store = useStore();

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

    const onKeyDown = (event: KeyboardEvent) => {
      const mayAct =
        isVoiceKeyAlone(event) &&
        !computerOwnsKeyboardEvent(event) &&
        !computerOwnsKeyboardFocus() &&
        openOverlay() === 'none';
      if (mayAct) hold.keyDown(event.repeat);
      else hold.interrupt();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'AltRight' && hold.keyUp()) event.preventDefault();
    };
    const interrupt = () => hold.interrupt();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hold.interrupt();
    };

    // Capture: a widget that stops a key on its way up still cancels the press.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', interrupt, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', interrupt, true);
      window.removeEventListener('wheel', interrupt, { capture: true });
      window.removeEventListener('blur', interrupt);
      document.removeEventListener('visibilitychange', onVisibility);
      hold.interrupt();
    };
  }, [store]);
};
