import classNames from 'classnames';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Badge, Icon, Icons, Text } from 'folds';
import { commandPaletteOpenAtom } from './commandPaletteState';
import {
  getCommandPaletteAriaKeyShortcuts,
  getCommandPaletteShortcutLabel,
} from './commandPaletteShortcut';
import * as css from './CommandPaletteSearchField.css';

type CommandPaletteSearchFieldProps = {
  /** Sizes and places the field where it sits, such as the phone top bar's touch target. */
  className?: string;
};

/**
 * "Find anything": a button drawn as a search field that opens the command palette on All and
 * names its keyboard shortcut. The phone's top bar and the sidebar's room lists show it.
 */
export function CommandPaletteSearchField({ className }: CommandPaletteSearchFieldProps) {
  const { t } = useTranslation();
  const [openTab, setOpenTab] = useAtom(commandPaletteOpenAtom);
  return (
    <button
      type="button"
      className={classNames(css.SearchField, className)}
      aria-keyshortcuts={getCommandPaletteAriaKeyShortcuts()}
      aria-haspopup="dialog"
      aria-expanded={openTab !== undefined}
      onClick={() => setOpenTab('all')}
    >
      <Icon size="100" src={Icons.Search} />
      <Text as="span" size="T300" truncate className={css.SearchPlaceholder}>
        {t('commandPalette.findAnything')}
      </Text>
      {/* Named by aria-keyshortcuts; its glyphs would only lengthen the button's name. */}
      <Badge as="kbd" variant="Secondary" fill="Soft" radii="300" aria-hidden>
        <Text as="span" size="L400">
          {getCommandPaletteShortcutLabel()}
        </Text>
      </Badge>
    </button>
  );
}
