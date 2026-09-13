import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useThreadsSelected } from '../../../hooks/router/useThreadsSelected';
import { getThreadsPath } from '../../pathUtils';

export function ThreadsTab() {
  const navigate = useNavigate();
  const selected = useThreadsSelected();

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip="Threads">
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={() => navigate(getThreadsPath())}
          >
            <Icon src={Icons.Thread} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
