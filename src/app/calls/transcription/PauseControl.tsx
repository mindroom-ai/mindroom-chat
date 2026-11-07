import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Icons } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { CallControl } from '../CallControls';
import { heldBy, liveTranscriptAtom, nameInCall, pauseHeldAtom } from './transcriptionState';
import * as css from './PauseControl.css';

/** The keys that press a button. */
const PRESS_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

/**
 * A click this soon after a pointer press ended is that press's own. A finger or pen lifts, leaves
 * the button, then clicks; a click much later (a press that ended elsewhere made none) is a click
 * on its own.
 */
const PRESS_CLICK_MS = 1_000;

/**
 * "Paused by Ann": who holds Pause in the room's call, this device's own press first (before
 * MindRoom has answered it), as MindRoom last said. None while nobody does.
 */
export const usePausedBy = (room: Room): string | undefined => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const ownUserId = useMatrixClient().getSafeUserId();
  const held = useAtomValue(pauseHeldAtom);
  const live = useAtomValue(liveTranscriptAtom);
  const holders = heldBy(live, room.roomId);
  const userIds = held && !holders.includes(ownUserId) ? [ownUserId, ...holders] : holders;
  if (userIds.length === 0) return undefined;
  const names = userIds.map((userId) => nameInCall(room, live, userId));
  return t('featureUi.calls.transcription.pausedBy', {
    names: new Intl.ListFormat(language, { type: 'conjunction' }).format(names),
  });
};

/**
 * Pause, held down: nothing anyone says is transcribed while anyone holds it. It holds while the
 * pointer, Space or Enter is down on it, and lets go on pointer up, cancel or leave and key up. A
 * click that comes without a press (screen readers, voice control, switch access) holds it until
 * the next click instead. Either lets go on focus loss, the window losing focus, the page being
 * hidden or going away, and when it goes. Held by anyone, it looks like the controls' warning and
 * says who holds it; its name stays, and its pressed state is this device's hold.
 */
export function PauseControl({ room, small }: { room: Room; small?: boolean }) {
  const { t } = useTranslation();
  const [held, setHeld] = useAtom(pauseHeldAtom);
  const pausedBy = usePausedBy(room);
  // The hold this control took, if any: pressed down, or clicked on until the next click. Only
  // that one is let go of here.
  const holding = useRef<'press' | 'click'>();
  // The latest pointer press, whose click is its own: when it ended, once it has.
  const pointerPress = useRef<{ endedAt?: number }>();

  const take = useCallback(
    (how: 'press' | 'click') => {
      holding.current = how;
      setHeld(true);
    },
    [setHeld]
  );
  const letGo = useCallback(() => {
    if (!holding.current) return;
    holding.current = undefined;
    setHeld(false);
  }, [setHeld]);
  const endPress = useCallback(() => {
    if (holding.current === 'press') letGo();
  }, [letGo]);
  const endPointerPress = useCallback(() => {
    const press = pointerPress.current;
    if (press && press.endedAt === undefined) press.endedAt = Date.now();
    endPress();
  }, [endPress]);

  useEffect(() => {
    if (!held) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') letGo();
    };
    window.addEventListener('blur', letGo);
    window.addEventListener('pagehide', letGo);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', letGo);
      window.removeEventListener('pagehide', letGo);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [held, letGo]);
  useEffect(() => letGo, [letGo]);

  const hint = t('featureUi.calls.transcription.pauseHint');
  return (
    <CallControl
      label={t('featureUi.calls.transcription.pause')}
      tooltip={pausedBy ?? hint}
      description={pausedBy ?? hint}
      icon={Icons.Pause}
      warning={!!pausedBy}
      pressed={held}
      small={small}
      className={css.HoldControl}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        pointerPress.current = {};
        take('press');
      }}
      onPointerUp={endPointerPress}
      onPointerCancel={endPointerPress}
      onPointerLeave={endPointerPress}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!PRESS_KEYS.has(event.key)) return;
        // Held keys make no click.
        event.preventDefault();
        if (!event.repeat) take('press');
      }}
      onKeyUp={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!PRESS_KEYS.has(event.key)) return;
        event.preventDefault();
        endPress();
      }}
      onClick={() => {
        const press = pointerPress.current;
        pointerPress.current = undefined;
        if (press && (press.endedAt === undefined || Date.now() - press.endedAt < PRESS_CLICK_MS)) {
          return;
        }
        if (holding.current === 'click' && held) letGo();
        else take('click');
      }}
      onBlur={letGo}
      // A long press on a phone holds Pause rather than opening a menu.
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
