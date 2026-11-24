import { useEffect, useRef, useState } from 'react';
import { useStore } from 'jotai';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';
import { useComposingCheck } from '../lib/hooks/useComposingCheck';
import { openOverlay } from '../shortcuts/shortcutDom';
import { isComposingKey, matchesShortcut } from '../shortcuts/shortcuts';
import {
  VOICE_HOLD_MS,
  createVoiceHold,
  type VoiceHold,
  type VoiceHoldTarget,
} from '../shortcuts/voiceHold';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';

/** A composer that records voice: its root element, whether it writes a thread, and its actions. */
export type VoiceComposer = VoiceHoldTarget & {
  root: () => HTMLElement | null;
  thread: boolean;
  /** A recording whose send failed waits here, in this composer alone. */
  offersFailed: () => boolean;
};

/** One mounted composer: `current` is its latest render, `target` acts on that while mounted. */
type Entry = { current?: VoiceComposer; target: VoiceHoldTarget };

// In mount order, like the shortcut handlers.
const entries = new Set<Entry>();

/** Rendered and not inert (under a side panel, behind the phone's navigation drawer). */
const shown = (root: HTMLElement | null | undefined): boolean =>
  !!root?.isConnected && !root.closest('[inert]') && root.getClientRects().length > 0;

// A press pins an entry's target, so each call reads the composer as it is then, and one that went
// away or out of sight since (the test a press picks its composer by) does nothing: a recording
// that runs stays the account's.
const createEntry = (): Entry => {
  const live = () =>
    entries.has(entry) && shown(entry.current?.root()) ? entry.current : undefined;
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
 * The composer a press of the voice key acts in, among those shown. One that offers a failed
 * recording is the only one that may (no other recording starts while it waits); else the focused
 * composer, else the open thread's, else the room's. A recording that runs is the account's and
 * shows in every composer (capture/liveCapture.ts), so it is sent from the one found so.
 */
export const resolveVoiceComposer = (
  focused: Element | null = document.activeElement
): VoiceHoldTarget | undefined => {
  const live = [...entries].reverse().filter((entry) => shown(entry.current?.root()));
  return (
    live.find((entry) => entry.current?.offersFailed()) ??
    live.find((entry) => !!focused && !!entry.current?.root()?.contains(focused)) ??
    live.find((entry) => entry.current?.thread) ??
    live[0]
  )?.target;
};

/**
 * The voice key: Space pressed with Control and Shift (⌃⇧Space, Ctrl+Shift+Space) records a voice
 * message in the composer `resolveVoiceComposer` finds (`createVoiceHold`); the first of the
 * three keys to come up releases it. Not over a dialog, menu or popover, for the Computer screen,
 * with a mouse button down, in an input method, or with the `voiceHoldShortcut` setting off. The
 * Space of a press it acts on (its keydown, repeats and keyup) is cancelled, so no space is typed
 * and no focused button clicks; every other key keeps its meaning.
 */
export const useVoiceHoldShortcut = (enabled: boolean): void => {
  const store = useStore();
  const composing = useComposingCheck();
  // Read live: switched off, the key arms nothing, and a press under way ends as interrupted.
  const enabledRef = useRef(enabled);
  const holdRef = useRef<VoiceHold>(undefined);
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
    // Mouse buttons down, as a press then is part of a drag or a click.
    const pointers = new Set<number>();
    // The Space key (by place: ⌥ turns its character into another) is down for a press the key
    // acts on: its repeats and keyup are the app's too, even after a modifier came up, the press
    // was interrupted or the window lost the focus. A new Space keydown decides afresh, so a
    // keyup that macOS dropped under ⌘ never outlives the press.
    let ownsSpace = false;

    const onKeyDown = (event: KeyboardEvent) => {
      const space = event.code === 'Space';
      // The Space key by place for arming too, so the press always owns the key that armed it.
      const voiceKey =
        space &&
        enabledRef.current &&
        pointers.size === 0 &&
        matchesShortcut(event, 'voiceRecord') &&
        !isComposingKey(event) &&
        !composing(event) &&
        !computerOwnsKeyboardEvent(event) &&
        !computerOwnsKeyboardFocus() &&
        openOverlay() === 'none';
      if (voiceKey) hold.keyDown(event.repeat);
      else hold.interrupt();
      if (space && !event.repeat) ownsSpace = voiceKey && hold.state !== 'ignored';
      if (space && ownsSpace) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // The first of the three keys to come up ends the press.
      const space = event.code === 'Space';
      const acted = (space || event.key === 'Control' || event.key === 'Shift') && hold.keyUp();
      if (acted || (space && ownsSpace)) event.preventDefault();
      if (space) ownsSpace = false;
    };
    const interrupt = () => hold.interrupt();
    const onPointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      hold.interrupt();
    };
    const onPointerUp = (event: PointerEvent) => pointers.delete(event.pointerId);
    const onBlur = () => {
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
  }, [composing, store]);
};
