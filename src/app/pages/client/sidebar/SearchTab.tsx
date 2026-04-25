import React from 'react';
import { Icon, Icons } from 'folds';
import { useAtom } from 'jotai';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { commandPaletteOpenAtom } from '../../../mindroom/command-palette/commandPaletteState';

export function SearchTab() {
  const [opened, setOpen] = useAtom(commandPaletteOpenAtom);

  const open = () => setOpen(true);

  return (
    <SidebarItem active={opened}>
      <SidebarItemTooltip tooltip="Open command palette">
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={open}
            aria-label="Open command palette"
          >
            <Icon src={Icons.Terminal} filled={opened} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
