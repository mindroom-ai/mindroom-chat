import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { MenuEntry } from '../ui/MenuEntry';
import { useDebugMode } from '../diagnostics/useDebugMode';
import { ComposerIconButton } from './ComposerIconButton';
import { ComposerMenuButton } from './ComposerMenuButton';
import * as css from './RoomInput.css';

type ComposerAttachButtonProps = {
  onAttach(): void;
  /** Stages this device's diagnostics as a file; offered while debug mode is on. */
  onAttachAppLogs(): void;
};

/**
 * The wide composer's plus button. It opens the file picker, and while debug mode is on a menu
 * with Attach files and Attach app logs instead.
 */
export function ComposerAttachButton({ onAttach, onAttachAppLogs }: ComposerAttachButtonProps) {
  const { t } = useTranslation();
  const debugMode = useDebugMode();

  if (!debugMode) {
    return <ComposerIconButton label={t('composer.attach')} icon={Icons.PlusCircle} onPress={onAttach} />;
  }
  return (
    <ComposerMenuButton label={t('composer.attachMenu')} icon={Icons.PlusCircle}>
      {({ choose }) => (
        <>
          <MenuEntry
            role="menuitem"
            className={css.ComposerMenuItem}
            label={t('composer.attach')}
            icon={Icons.Attachment}
            onSelect={choose(onAttach)}
          />
          <MenuEntry
            role="menuitem"
            className={css.ComposerMenuItem}
            label={t('composer.attachAppLogs')}
            icon={Icons.File}
            onSelect={choose(onAttachAppLogs)}
          />
        </>
      )}
    </ComposerMenuButton>
  );
}
