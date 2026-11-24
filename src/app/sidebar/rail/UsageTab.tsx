import { type CSSProperties, type RefCallback } from 'react';
import { color } from 'folds';
import { IconGauge } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getUsagePath } from '../../routes/pathUtils';
import { useUsageSelected } from '../../routes/useUsageSelected';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import { useProviderUsage } from '../../usage/useProviderUsage';

const LOW_QUOTA_DOT_STYLE: CSSProperties = {
  display: 'block',
  inlineSize: '10px',
  blockSize: '10px',
  borderRadius: '9999px',
  backgroundColor: color.Warning.Main,
  boxShadow: `0 0 0 2px ${color.Background.Container}`,
};

/** Whether any runtime has reported provider usage data for this session. */
export const useHasProviderUsage = (): boolean => useProviderUsage().available;

/**
 * The Usage button of the icon rail: progressively reveals once a runtime answers with provider
 * usage data (matching CanvasesTab) and shows a subtle amber dot while any window is under 15%.
 */
export function UsageTab() {
  const navigate = useNavigate();
  const active = useUsageSelected();
  const { t } = useTranslation();
  const { available, hasLowQuota } = useProviderUsage();
  const tooltip = t('nav.usage');
  const label = hasLowQuota ? t('mindroomUi.usage.navLowQuota') : tooltip;

  // Stays visible while the Usage page is open, matching CanvasesTab.
  if (!available && !active) return null;

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar
      ref={tooltipAnchor}
      as="button"
      aria-label={label}
      outlined
      onClick={() => void navigate(getUsagePath())}
    >
      <IconGauge size={20} stroke={active ? 2.2 : 1.8} aria-hidden="true" />
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={active}>
      <SidebarItemTooltip tooltip={tooltip}>{renderButton}</SidebarItemTooltip>
      {hasLowQuota && (
        <SidebarItemBadge>
          <span style={LOW_QUOTA_DOT_STYLE} data-usage-low-quota="true" aria-hidden="true" />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
