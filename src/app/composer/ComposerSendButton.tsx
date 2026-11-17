import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Icons, toRem, type IconSrc, type RectCords } from 'folds';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { useConversationHidden } from '../navigation/conversationView';
import { usePointerLongPress } from '../lib/hooks/usePointerLongPress';
import type { MidTurnMode } from '../preferences/settings';
import { ComposerIconButton } from './ComposerIconButton';
import * as css from './RoomInput.css';

type ComposerSendButtonProps = {
  label: string;
  /** No other control beside it, so its touch hit area takes the full 44 px width. */
  alone?: boolean;
  /** An agent replies in the thread now, so holding the button offers the modes. */
  agentReplying: boolean;
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

const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) => isHotkey(name, event);

/**
 * The composer's Send button. A tap or Enter sends with the default mode. While an agent replies in
 * the thread, holding it `LONG_PRESS_MS` opens a menu above it: Steer, Queue and Auto, each with a
 * line on what it does; the one picked sends the message with that mode. Without a reply, a hold
 * is a tap. Escape closes the menu, and focus goes back to the button if it was in the menu.
 */
export function ComposerSendButton({
  label,
  alone,
  agentReplying,
  onSend,
}: ComposerSendButtonProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  // The menu closes as the conversation hides, under a plugin's cover or behind a side panel.
  const conversationHidden = useConversationHidden();
  if (conversationHidden && anchor) setAnchor(undefined);
  const buttonRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const refocusRef = useRef(false);
  const press = usePointerLongPress(
    (element) => {
      buttonRef.current = element;
      setAnchor(element.getBoundingClientRect());
    },
    () => agentReplying
  );
  const menuLabel = t('composer.midTurn.menuLabel');

  // Focus goes back once the menu and its focus trap are gone, which a still active trap would undo.
  useEffect(() => {
    if (anchor || !refocusRef.current) return;
    refocusRef.current = false;
    buttonRef.current?.focus();
  }, [anchor]);

  const close = () => {
    setAnchor(undefined);
    return true;
  };

  return (
    <PopOut
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
            // The click that ends the hold comes after the menu opened; it closes nothing.
            clickOutsideDeactivates: (event) => event.type !== 'click' && close(),
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
            style={{ minWidth: toRem(240), maxWidth: toRem(320) }}
          >
            <MenuGroup>
              {MID_TURN_CHOICES.map((choice) => (
                <MenuEntry
                  key={choice.mode}
                  role="menuitem"
                  className={css.ComposerMenuItem}
                  label={t(choice.label)}
                  description={t(choice.hint)}
                  icon={choice.icon}
                  directional={choice.mode === 'steer'}
                  onSelect={() => {
                    setAnchor(undefined);
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
        label={label}
        icon={Icons.Send}
        directional
        variant="Primary"
        onPress={() => onSend()}
        alone={alone}
        keepsTextFocus
        aria-haspopup={agentReplying ? 'menu' : undefined}
        aria-expanded={agentReplying ? anchor !== undefined : undefined}
      />
    </PopOut>
  );
}
