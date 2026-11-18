import { useTranslation } from 'react-i18next';
import { Icons, type RectCords } from 'folds';
import { MenuEntry } from '../ui/MenuEntry';
import { useDebugMode } from '../diagnostics/useDebugMode';
import { ComposerMenuButton } from './ComposerMenuButton';
import * as css from './RoomInput.css';

type ComposerActionsMenuProps = {
  formattingOpen: boolean;
  onAttach(): void;
  /** Stages this device's diagnostics as a file; offered while debug mode is on. */
  onAttachAppLogs(): void;
  onToggleFormatting(): void;
  /** Opens the emoji board at the given place, the "More actions" button. */
  onEmoji(anchor: RectCords): void;
};

/**
 * The phone composer's "More actions" button and its menu: Attach files, Formatting and Emoji,
 * the controls a phone row has no room for, and Attach app logs while debug mode is on.
 */
export function ComposerActionsMenu({
  formattingOpen,
  onAttach,
  onAttachAppLogs,
  onToggleFormatting,
  onEmoji,
}: ComposerActionsMenuProps) {
  const { t } = useTranslation();
  const debugMode = useDebugMode();

  return (
    <ComposerMenuButton label={t('composer.moreActions')} icon={Icons.PlusCircle}>
      {({ choose, chooseAt }) => (
        <>
          <MenuEntry
            role="menuitem"
            className={css.ComposerMenuItem}
            label={t('composer.attach')}
            icon={Icons.Attachment}
            onSelect={choose(onAttach)}
          />
          {debugMode && (
            <MenuEntry
              role="menuitem"
              className={css.ComposerMenuItem}
              label={t('composer.attachAppLogs')}
              icon={Icons.File}
              onSelect={choose(onAttachAppLogs)}
            />
          )}
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
            onSelect={chooseAt(onEmoji)}
          />
        </>
      )}
    </ComposerMenuButton>
  );
}
