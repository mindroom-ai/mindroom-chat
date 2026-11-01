import React, { useEffect } from 'react';
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

  useEffect(() => {
    // The native shells keep the portal out of their web view.
    if (!onlyBackend || Capacitor.isNativePlatform()) return undefined;
    const controller = new AbortController();
    // A failed token request leaves the card, whose button opens the portal in a window instead.
    handOff(onlyBackend, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [handOff, onlyBackend]);

  return (
    <Page>
      <PageContent>
        <MindroomConnectionsSettings />
      </PageContent>
    </Page>
  );
}
