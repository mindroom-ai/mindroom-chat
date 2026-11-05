import { useState } from 'react';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import { Modal500 } from '../../ui/Modal500';
import { Settings } from '../../settings/Settings';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../local-mindroom/settingsPage';
import mindroomLogo from '../../../../public/res/branding/mindroom-logo.png';
import { LinkIndicator } from './LocalMindroomTab.css';

/** The brand's name, the same in every language; it is also the button's accessible name. */
const LOGO_NAME = 'MindRoom';
const LOGO_SIZE_PX = 36;
// The whole logo shows, however its file is proportioned.
const LOGO_FIT = { objectFit: 'contain' } as const;

/**
 * The rail's Local MindRoom button: the MindRoom logo with a link mark in its corner. It opens
 * Settings on the page that pairs a MindRoom running on the person's own machine with this
 * account. The dialog is rendered only while open, so every press starts on that page.
 */
export function LocalMindroomTab() {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = () => setSettingsOpen(false);

  return (
    <>
      <SidebarItem>
        <SidebarItemTooltip tooltip={t('mindroomUi.sidebar.mindroomTab.localMindroom')}>
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              outlined
              onClick={() => setSettingsOpen(true)}
            >
              <img
                src={mindroomLogo}
                alt={LOGO_NAME}
                width={LOGO_SIZE_PX}
                height={LOGO_SIZE_PX}
                style={LOGO_FIT}
              />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
        {/* Says what the button is, so it always shows; it is not a count. */}
        <SidebarItemBadge hasCount>
          <span className={LinkIndicator}>
            <Icon size="100" src={Icons.Link} />
          </span>
        </SidebarItemBadge>
      </SidebarItem>
      {settingsOpen && (
        <Modal500 requestClose={closeSettings}>
          <Settings initialPage={LOCAL_MINDROOM_SETTINGS_PAGE} requestClose={closeSettings} />
        </Modal500>
      )}
    </>
  );
}
