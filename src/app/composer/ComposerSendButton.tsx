import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Icons, toRem, type IconSrc, type RectCords } from 'folds';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { useConversationHidden } from '../navigation/conversationView';
import { usePointerLongPress } from '../lib/hooks/usePointerLongPress';
import type { MidTurnMode } from '../preferences/midTurnModes';
import { ComposerIconButton } from './ComposerIconButton';
import * as css from './RoomInput.css';

type ComposerSendButtonProps = {
  label: string;
  /** No other control beside it, so its touch hit area takes the full 44 px width. */
  alone?: boolean;
  /** An agent replies in the thread now, so holding the button offers the modes. */
  agentReplying: boolean;
  /** Whether the composer holds text to send; only a text message carries a mode. */
  hasText: () => boolean;
  /** The mode a tap sends with, from the Chats setting; its row in the menu says so. */
  defaultMode: MidTurnMode;
  /** Sends the message, with the mode picked from the menu, or the default one for a tap. */
  onSend: (mode?: MidTurnMode) => void | Promise<unknown>;
};

/** The modes the menu offers, in its order, as the Chats settings name them. */
export const MID_TURN_CHOICES = [
  {
    mode: 'steer',
    icon: Icons.ArrowGoRight,
    label: 'composer.midTurn.steer',
    hint: 'composer.midTurn.steerHint',
  },
  {
    mode: 'queue',
    icon: Icons.RecentClock,
    label: 'composer.midTurn.queue',
    hint: 'composer.midTurn.queueHint',
  },
  {
    mode: 'auto',
    icon: Icons.Bulb,
    label: 'composer.midTurn.auto',
    hint: 'composer.midTurn.autoHint',
  },
] as const satisfies ReadonlyArray<{
  mode: MidTurnMode;
  icon: IconSrc;
  label: string;
  hint: string;
}>;

// A mouse resting on Send this long opens the menu, so a quick move on to click it opens nothing.
const HOVER_OPEN_MS = 300;
// How long a menu a mouse opened stays once the mouse leaves it and the button, the gap between
// them included.
const HOVER_CLOSE_MS = 200;

/**
 * The composer's Send button. A tap or Enter sends with the default mode. While an agent replies in
 * the thread, holding it `LONG_PRESS_MS` opens a menu above it: Steer, Queue and Auto, each with a
 * line on what it does; the one picked sends the message with that mode. A mouse resting on it
 * `HOVER_OPEN_MS` opens the same menu, which closes again once the mouse has left both for
 * `HOVER_CLOSE_MS`, unless focus is in it; a click on the button still sends with the default
 * mode. A finger or a pen only holds. Without a reply, or without text to send (a voice message or
 * files alone carry no mode), a hold is a tap and a rest opens nothing. Escape closes the menu, and
 * focus goes back to the button if it was in the menu.
 */
export function ComposerSendButton({
  label,
  alone,
  agentReplying,
  hasText,
  defaultMode,
  onSend,
}: ComposerSendButtonProps) {
  const { t } = useTranslation();
  // `hover`: a resting mouse opened it, rather than a hold.
  const [menu, setMenu] = useState<{ anchor: RectCords; hover: boolean }>();
  const anchor = menu?.anchor;
  // The menu closes as the conversation hides, under a plugin's cover or behind a side panel.
  const conversationHidden = useConversationHidden();
  if (conversationHidden && menu) setMenu(undefined);
  const buttonRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const refocusRef = useRef(false);
  const canOpen = () => agentReplying && hasText();
  const canOpenRef = useRef(canOpen);
  canOpenRef.current = canOpen;
  const press = usePointerLongPress((element) => {
    buttonRef.current = element;
    setMenu({ anchor: element.getBoundingClientRect(), hover: false });
  }, canOpen);
  // Opens the menu for a mouse resting on the button, or closes it once the mouse has gone.
  const hoverTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const menuLabel = t('composer.midTurn.menuLabel');

  // Focus goes back once the menu and its focus trap are gone, which a still active trap would undo.
  useEffect(() => {
    if (anchor || !refocusRef.current) return;
    refocusRef.current = false;
    buttonRef.current?.focus();
  }, [anchor]);

  const close = () => {
    setMenu(undefined);
    return true;
  };

  const onPointerEnter = (evt: PointerEvent<HTMLElement>) => {
    if (evt.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer.current);
    if (menu) return;
    const element = evt.currentTarget;
    hoverTimer.current = window.setTimeout(() => {
      if (!canOpenRef.current()) return;
      buttonRef.current = element;
      setMenu({ anchor: element.getBoundingClientRect(), hover: true });
    }, HOVER_OPEN_MS);
  };
  const onPointerLeave = (evt: PointerEvent<HTMLElement>) => {
    if (evt.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer.current);
    if (!menu?.hover) return;
    hoverTimer.current = window.setTimeout(() => {
      // A keyboard in the menu keeps it.
      if (menuRef.current?.contains(document.activeElement)) return;
      setMenu((current) => (current?.hover ? undefined : current));
    }, HOVER_CLOSE_MS);
  };
  // In a menu a mouse opened, the arrows move through it only once focus is there, and otherwise
  // stay with the text box; after a hold they also bring focus in from it.
  const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) =>
    isHotkey(name, event) &&
    (!menu?.hover || !!menuRef.current?.contains(event.target as Node | null));

  return (
    <PopOut
      // folds lays a full-window layer under the menu. After a hold it takes the press that closes
      // the menu; under a menu a mouse opened it lets the pointer through, so the button stays
      // hovered and its click sends.
      style={menu?.hover ? { pointerEvents: 'none' } : undefined}
      anchor={anchor}
      position="Top"
      align="End"
      offset={8}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            isKeyForward: arrowKey('arrowdown'),
            isKeyBackward: arrowKey('arrowup'),
            // The lift that ends the hold closes nothing: usePointerLongPress drops its events.
            clickOutsideDeactivates: close,
            escapeDeactivates: () => {
              // The text box keeps the focus it had; focus in the menu goes back to the button.
              refocusRef.current = !!menuRef.current?.contains(document.activeElement);
              return close();
            },
          }}
        >
          <Menu
            ref={menuRef}
            role="menu"
            aria-label={menuLabel}
            style={{ minWidth: toRem(240), maxWidth: toRem(320), pointerEvents: 'auto' }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <MenuGroup>
              {MID_TURN_CHOICES.map((choice) => (
                <MenuEntry
                  key={choice.mode}
                  role="menuitem"
                  className={css.ComposerMenuItem}
                  label={
                    choice.mode === defaultMode
                      ? t('composer.midTurn.defaultChoice', { label: t(choice.label) })
                      : t(choice.label)
                  }
                  description={t(choice.hint)}
                  icon={choice.icon}
                  directional={choice.mode === 'steer'}
                  onSelect={() => {
                    setMenu(undefined);
                    void onSend(choice.mode);
                  }}
                />
              ))}
            </MenuGroup>
          </Menu>
        </FocusTrap>
      }
    >
      <ComposerIconButton
        {...press}
        onPointerDown={(evt) => {
          // A press is a tap or a hold, never a rest.
          window.clearTimeout(hoverTimer.current);
          press.onPointerDown(evt);
        }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={(evt) => {
          press.onPointerLeave();
          onPointerLeave(evt);
        }}
        label={label}
        icon={Icons.Send}
        directional
        variant="Primary"
        onPress={() => onSend()}
        alone={alone}
        keepsTextFocus
        aria-haspopup={agentReplying ? 'menu' : undefined}
        aria-expanded={agentReplying ? anchor !== undefined : undefined}
        tooltipHidden={anchor !== undefined}
      />
    </PopOut>
  );
}
