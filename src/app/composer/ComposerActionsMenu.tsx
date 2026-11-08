import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Icon, Icons, toRem, type RectCords } from 'folds';
import { PopOut } from '../ui/directional';
import { IconButton, Menu } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { conversationHiddenAtom } from '../navigation/conversationCover';
import * as css from './RoomInput.css';

type ComposerActionsMenuProps = {
  formattingOpen: boolean;
  onAttach(): void;
  onToggleFormatting(): void;
  /** Opens the emoji board at the given place, the "More actions" button. */
  onEmoji(anchor: RectCords): void;
};

const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) => isHotkey(name, event);

/**
 * The phone composer's "More actions" button and its menu: Attach files, Formatting and Emoji,
 * the controls a phone row has no room for. Escape closes the menu and focus returns to the button.
 */
export function ComposerActionsMenu({
  formattingOpen,
  onAttach,
  onToggleFormatting,
  onEmoji,
}: ComposerActionsMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  // The menu closes as the conversation hides, under a plugin's cover or behind a side panel.
  const conversationHidden = useAtomValue(conversationHiddenAtom);
  if (conversationHidden && anchor) setAnchor(undefined);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);
  const label = t('composer.moreActions');

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
  const choose = (action: () => void) => () => {
    setAnchor(undefined);
    action();
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
            <MenuGroup>
              <MenuEntry
                role="menuitem"
                className={css.ComposerMenuItem}
                label={t('composer.attach')}
                icon={Icons.Attachment}
                onSelect={choose(onAttach)}
              />
              <MenuEntry
                role="menuitemcheckbox"
                aria-checked={formattingOpen}
                className={css.ComposerMenuItem}
                label={t('composer.formatting')}
                icon={Icons.Text}
                onSelect={choose(onToggleFormatting)}
              />
              <MenuEntry
                role="menuitem"
                className={css.ComposerMenuItem}
                label={t('composer.emoji')}
                icon={Icons.Smile}
                onSelect={() => {
                  const at = buttonRef.current?.getBoundingClientRect() ?? anchor;
                  setAnchor(undefined);
                  if (at) onEmoji(at);
                }}
              />
            </MenuGroup>
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
            <Icon src={Icons.PlusCircle} />
          </IconButton>
        )}
      </IconTooltip>
    </PopOut>
  );
}
