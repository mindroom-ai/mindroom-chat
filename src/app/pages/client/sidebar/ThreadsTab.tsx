import React from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useThreadsSelected } from '../../../hooks/router/useThreadsSelected';
import { getThreadsPath } from '../../pathUtils';

/** The Threads button of the icon rail: threads across every room. */
export function ThreadsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = useThreadsSelected();
  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('featureUi.sidebar.threads')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('featureUi.sidebar.threads')}
            onClick={() => navigate(getThreadsPath())}
          >
            <Icon src={Icons.Thread} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
