import React, { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Page, PageContent } from '../../components/page';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { MindroomConnectionsSettings } from '../settings/MindroomConnectionsSettings';
import { useConnectionsHandoff } from './useOpenConnectionsPortal';

/**
 * `/connections` in Chat: with one MindRoom server, sign in to its Connections portal and open it in this tab.
 * The Settings card stays on the page, for several servers, none, or a sign-in that failed.
 */
export function ConnectionsPage() {
  const { urls, discovered } = useComputerApiUrls();
  const handOff = useConnectionsHandoff(discovered);
  const onlyBackend = urls.length === 1 ? urls[0] : undefined;
  const started = useRef(false);

  useEffect(() => {
    // The native shells keep the portal out of their web view.
    if (!onlyBackend || started.current || Capacitor.isNativePlatform()) return;
    started.current = true;
    handOff(onlyBackend).catch(() => {
      started.current = false;
    });
  }, [handOff, onlyBackend]);

  return (
    <Page>
      <PageContent>
        <MindroomConnectionsSettings />
      </PageContent>
    </Page>
  );
}
