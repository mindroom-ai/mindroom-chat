import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../ui/sidebar/SidebarItem';
import { useOpenCreateSpaceModal } from '../../navigation/useCreateSpaceModal';
import { useRailVisibilityMenuTrigger } from './railVisibilityMenuContext';

/** Creates a space from the icon rail. */
export function CreateTab() {
  const { t } = useTranslation();
  const openCreateSpace = useOpenCreateSpaceModal();
  const railMenuProps = useRailVisibilityMenuTrigger('createSpace');
  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={t('nav.createSpace')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.createSpace')}
            onClick={() => openCreateSpace()}
            {...railMenuProps}
          >
            <Icon src={Icons.Plus} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
