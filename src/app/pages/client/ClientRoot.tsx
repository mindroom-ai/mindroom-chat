import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, PopOut, Spinner, Text, config } from 'folds';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useActiveSession } from '../../hooks/useSessionStore';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { createMindroomSyncEngine, MindroomSyncEngineProvider } from '../../mindroom/engine';
import type { MindroomSyncEngine } from '../../mindroom/engine';
import type { StoredSession } from '../../state/sessions';
import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';
import {
  clearAllCacheAndReload,
  initClient,
  removeCurrentClientSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { getLoginPath } from '../pathUtils';
import { ClientStartupProvider } from './ClientStartupContext';
import { SpecVersions } from './SpecVersions';
import { SyncStatus } from './SyncStatus';

type ClientBootstrapSession = Parameters<typeof initClient>[0];

const toBootstrapSession = (session: StoredSession): ClientBootstrapSession =>
  ({
    sessionId: session.sessionId,




    refreshToken: session.refreshToken,
  } as ClientBootstrapSession);

/**
 * Whether the client restored rooms from its store, so the shell can render
 * before the first sync. A saved sync token alone does not count: without
 * rooms the shell would be empty.
 */
export const hasCachedClientShell = (mx: MatrixClient): boolean => mx.getRooms().length > 0;

type StartupState =
  | { status: 'loading'; mx?: MatrixClient }
  | { status: 'started'; mx: MatrixClient }
  | { status: 'error'; mx?: MatrixClient; error: unknown };

function StartupRecoveryMenu({ mx }: { mx?: MatrixClient }) {
  const { t } = useTranslation();





























































































































































































































































































      {children}
    </ClientSession>
  );
}
