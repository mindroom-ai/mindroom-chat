import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Icon, Icons, Text } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../ui/sidebar/SidebarItem';
import { commandPaletteOpenAtom } from './commandPaletteState';
import {
  getCommandPaletteAriaKeyShortcuts,
  getCommandPaletteShortcutLabel,
} from './commandPaletteShortcut';

/** The sidebar's search button: opens the command palette and teaches its shortcut. */
export function MindroomCommandPaletteSidebarTab() {
  const { t } = useTranslation();
  const [openTab, setOpenTab] = useAtom(commandPaletteOpenAtom);
  const open = openTab !== undefined;
  const label = t('commandPalette.open');

  return (
    <SidebarItem active={open}>
      <SidebarItemTooltip
        tooltip={
          <Box alignItems="Center" gap="200">
            <Text size="T300">{label}</Text>
            <Badge as="kbd" variant="Secondary" fill="Soft" radii="300">
              <Text size="L400">{getCommandPaletteShortcutLabel()}</Text>
            </Badge>
          </Box>
        }
      >
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            aria-keyshortcuts={getCommandPaletteAriaKeyShortcuts()}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpenTab('all')}
          >
            <Icon src={Icons.Search} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

export { MindroomCommandPaletteSidebarTab as SearchTab };
