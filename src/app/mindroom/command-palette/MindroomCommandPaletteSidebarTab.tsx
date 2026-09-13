import React from 'react';
import { Icon, Icons } from 'folds';
import { useAtom } from 'jotai';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { commandPaletteOpenAtom } from './commandPaletteState';

export function MindroomCommandPaletteSidebarTab() {
  const [opened, setOpen] = useAtom(commandPaletteOpenAtom);
  const simpleMode = useSimpleMode();
  if (simpleMode) return null;

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
