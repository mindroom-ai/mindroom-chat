import React from 'react';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useOpenCreateSpaceModal } from '../../../state/hooks/createSpaceModal';

/** Creates a space from the icon rail. */
export function CreateTab() {
  const { t } = useTranslation();
  const openCreateSpace = useOpenCreateSpaceModal() as () => void;
  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={t('featureUi.sidebar.createSpace')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('featureUi.sidebar.createSpace')}
            onClick={() => openCreateSpace()}
          >
            <Icon src={Icons.Plus} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
