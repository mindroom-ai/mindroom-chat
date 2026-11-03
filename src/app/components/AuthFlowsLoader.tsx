import React, { ReactNode, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IAuthData, ILoginFlowsResponse, MatrixClient } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text } from 'folds';
import { useAutoDiscoveryInfo } from '../hooks/useAutoDiscoveryInfo';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { createMatrixClient } from '../mindroom/matrix/matrixClientFactory';

export enum RegisterFlowStatus {
  /** Registration is open; `data` lists the user-interactive auth flows. */
  FlowRequired = 401,
  Disabled = 403,





  | { status: RegisterFlowStatus.FlowRequired; data: IAuthData }
  | {






};

/** An empty registration request answers 401 with the server's sign-up flows when sign-up is open. */
const getRegisterFlows = async (mx: MatrixClient): Promise<RegisterFlowsResponse> => {
  try {
    await mx.registerRequest({});
    return { status: RegisterFlowStatus.InvalidRequest };
  } catch (error) {
    const { httpStatus, data } = (error ?? {}) as { httpStatus?: number; data?: IAuthData };
    if (httpStatus === RegisterFlowStatus.FlowRequired && data?.flows) {
      return { status: RegisterFlowStatus.FlowRequired, data };
    }
    if (httpStatus === RegisterFlowStatus.Disabled) return { status: RegisterFlowStatus.Disabled };
    if (httpStatus === RegisterFlowStatus.RateLimited) {








  /** Explains a failure above the retry button. */









  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);

  const [state, load] = useAsyncCallback(
    useCallback(async (): Promise<AuthFlows> => {
      const loginFlows = await mx.loginFlows();
      if (!loginFlows || !Array.isArray(loginFlows.flows)) {
        throw new Error('The homeserver returned no login flows.');
      }
      const registerFlows = await getRegisterFlows(mx);
      return { loginFlows, registerFlows };
    }, [mx])
  );

  const retry = useCallback(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    retry();
  }, [retry]);

  if (state.status === AsyncStatus.Success) return <>{children(state.data)}</>;

  if (state.status === AsyncStatus.Error) {
    return (
      <Box direction="Column" alignItems="Center" gap="300">
        {error?.(state.error) ?? (
          <Text size="T300" align="Center">
            {t('sharedUi.authFlowsLoader.failedToLoadAuthenticationFlowInformation')}
          </Text>
        )}
        <Button variant="Secondary" size="300" onClick={retry}>
          {t('sharedUi.authFlowsLoader.retry')}
        </Button>
      </Box>
    );
  }

  return (
    <>
      {fallback?.() ?? (
        <Box justifyContent="Center">
          <Spinner variant="Secondary" size="400" />
        </Box>
      )}
    </>
  );
}
