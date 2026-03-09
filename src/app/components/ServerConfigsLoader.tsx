import React, { ReactNode, useCallback, useMemo } from 'react';
import { Capabilities, MatrixClient, validateAuthMetadata, ValidatedAuthMetadata } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { promiseFulfilledResult } from '../utils/common';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
};

type ServerConfigsLoaderProps = {
  mx?: Pick<MatrixClient, 'getCapabilities' | 'getMediaConfig' | 'getAuthMetadata'>;
  children: (configs: ServerConfigs) => ReactNode;
};

type ServerConfigsLoaderInnerProps = {
  mx: Pick<MatrixClient, 'getCapabilities' | 'getMediaConfig' | 'getAuthMetadata'>;
  children: (configs: ServerConfigs) => ReactNode;
};

function ServerConfigsLoaderInner({ mx, children }: ServerConfigsLoaderInnerProps) {
  const fallbackConfigs = useMemo(() => ({}), []);

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(async () => {
      const result = await Promise.allSettled([
        mx.getCapabilities(),
        mx.getMediaConfig(),
        mx.getAuthMetadata(),
      ]);

      const capabilities = promiseFulfilledResult(result[0]);
      const mediaConfig = promiseFulfilledResult(result[1]);
      const authMetadata = promiseFulfilledResult(result[2]);
      let validatedAuthMetadata: ValidatedAuthMetadata | undefined;

      if (authMetadata !== undefined) {
        try {
          validatedAuthMetadata = validateAuthMetadata(authMetadata);
        } catch (e) {
          console.error(e);
        }
      }

      return {
        capabilities,
        mediaConfig,
        authMetadata: validatedAuthMetadata,
      };
    }, [mx])
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return children(configs);
}

function ServerConfigsLoaderFromContext({ children }: Pick<ServerConfigsLoaderProps, 'children'>) {
  const mx = useMatrixClient();
  return <ServerConfigsLoaderInner mx={mx}>{children}</ServerConfigsLoaderInner>;
}

export function ServerConfigsLoader({ mx: explicitMx, children }: ServerConfigsLoaderProps) {
  if (explicitMx) {
    return <ServerConfigsLoaderInner mx={explicitMx}>{children}</ServerConfigsLoaderInner>;
  }

  return <ServerConfigsLoaderFromContext>{children}</ServerConfigsLoaderFromContext>;
}
