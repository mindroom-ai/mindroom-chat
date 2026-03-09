import React, { useState } from 'react';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import MindRoomLogo from '../../../../../public/res/branding/mindroom-logo.png';
import { Modal500 } from '../../../components/Modal500';
import { Settings, SettingsPages } from '../../../features/settings';

export function MindroomTab() {
  const [settings, setSettings] = useState(false);

  return (
    <>
      <SidebarItem active={settings}>
        <SidebarItemTooltip tooltip="Local MindRoom">
          {(triggerRef) => (
            <SidebarAvatar as="button" ref={triggerRef} outlined onClick={() => setSettings(true)}>
              <img
                src={MindRoomLogo}
                alt="MindRoom"
                width={36}
                height={36}
                style={{ objectFit: 'contain' }}
              />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
      </SidebarItem>
      {settings && (
        <Modal500 requestClose={() => setSettings(false)}>
          <Settings
            initialPage={SettingsPages.LocalMindroomPage}
            requestClose={() => setSettings(false)}
          />
        </Modal500>
      )}
    </>
  );
}
