import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Icon, toRem, type IconSrc, type RectCords } from 'folds';
import { PopOut } from '../ui/directional';
import { IconButton, Menu } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import { MenuGroup } from '../ui/MenuEntry';
import { useConversationHidden } from '../navigation/conversationView';
import * as css from './RoomInput.css';

export type ComposerMenuControls = {
  /** Closes the menu, then runs the action. */
  choose(action: () => void): () => void;
  /** Closes the menu, then runs the action at the button's place (a board that opens there). */
  chooseAt(action: (anchor: RectCords) => void): () => void;
};

type ComposerMenuButtonProps = {
  /** The button's tooltip and aria-label, and the menu's name. */
  label: string;
  icon: IconSrc;
  /** The menu's entries, `MenuEntry` rows that close the menu through the controls. */
  children(controls: ComposerMenuControls): ReactNode;
};

const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) => isHotkey(name, event);

/**
 * A composer icon button that opens a small menu above it. Arrow keys move between the entries,
 * Escape closes the menu and focus returns to the button, and the menu closes as the conversation
 * hides.
 */
export function ComposerMenuButton({ label, icon, children }: ComposerMenuButtonProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  // The menu closes as the conversation hides, under a plugin's cover or behind a side panel.
  const conversationHidden = useConversationHidden();
  if (conversationHidden && anchor) setAnchor(undefined);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);

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
  const controls: ComposerMenuControls = {
    choose: (action) => () => {
      setAnchor(undefined);
      action();
    },
    chooseAt: (action) => () => {
      const at = buttonRef.current?.getBoundingClientRect() ?? anchor;
      setAnchor(undefined);
      if (at) action(at);
    },
  };

  return (
    <PopOut
      anchor={anchor}
      position="Top"
      align="Start"
      offset={8}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            isKeyForward: arrowKey('arrowdown'),
            isKeyBackward: arrowKey('arrowup'),
            // A press on the button closes the menu here too; the shared Menu drops the click
            // that ends it (ui/glass/menuBehaviour.ts).
            clickOutsideDeactivates: close,
            escapeDeactivates: () => {
              refocusRef.current = true;
              return close();
            },
          }}
        >
          <Menu role="menu" aria-label={label} style={{ minWidth: toRem(200) }}>
            <MenuGroup>{children(controls)}</MenuGroup>
          </Menu>
        </FocusTrap>
      }
    >
      <IconTooltip position="Top" label={label}>
        {(triggerRef) => (
          <IconButton
            ref={(element: HTMLButtonElement | null) => {
              buttonRef.current = element;
              triggerRef(element);
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) =>
              setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect())
            }
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={anchor !== undefined}
            variant="SurfaceVariant"
            radii="300"
            size="300"
            className={css.ComposerIconButton}
          >
            <Icon src={icon} />
          </IconButton>
        )}
      </IconTooltip>
    </PopOut>
  );
}
