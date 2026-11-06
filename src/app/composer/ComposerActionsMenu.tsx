import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Icon, Icons, toRem, type RectCords } from 'folds';
import { PopOut } from '../ui/directional';
import { IconButton, Menu } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import * as css from './RoomInput.css';

type ComposerActionsMenuProps = {
  formattingOpen: boolean;
  onAttach(): void;
  onToggleFormatting(): void;
  /** Opens the emoji board at the given place, the "More actions" button. */
  onEmoji(anchor: RectCords): void;
};

const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) => isHotkey(name, event);

/** How far past its edges the button's touch hit area reaches (44 px tall, 2 px to each side). */
const HIT_SLOP = 6;
/** How long after a press that closed the menu its click may still arrive. */
const IGNORE_CLICK_MS = 1000;

/** Whether a press lands on the button or the hit area around it. */
const pressesButton = (event: MouseEvent | TouchEvent, button: HTMLElement | null): boolean => {
  const point = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
  if (!button || !point) return false;
  const rect = button.getBoundingClientRect();
  return (
    point.clientX >= rect.left - HIT_SLOP &&
    point.clientX <= rect.right + HIT_SLOP &&
    point.clientY >= rect.top - HIT_SLOP &&
    point.clientY <= rect.bottom + HIT_SLOP
  );
};

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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);
  // The open menu's full-screen layer takes the press that closes it; the click that follows
  // reaches the button once the layer is gone, and must not open the menu again. It comes within
  // this time of the press, so a later tap is never lost.
  const ignoreClickUntilRef = useRef(0);
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
            clickOutsideDeactivates: (event) => {
              if (pressesButton(event, buttonRef.current)) {
                ignoreClickUntilRef.current = performance.now() + IGNORE_CLICK_MS;
              }
              return close();
            },
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
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              if (performance.now() < ignoreClickUntilRef.current) {
                ignoreClickUntilRef.current = 0;
                return;
              }
              setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect());
            }}
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
