import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useCanvasesSelected } from '../../../hooks/router/useCanvasesSelected';
import { getCanvasesPath } from '../../pathUtils';

export function CanvasesTab({ onSelect }: { onSelect?: (selected: boolean) => boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = useCanvasesSelected();

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('nav.canvases')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.canvases')}
            onClick={() => {
              onSelect?.(false);
              navigate(getCanvasesPath());
            }}
          >
            <Icon src={Icons.Category} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
