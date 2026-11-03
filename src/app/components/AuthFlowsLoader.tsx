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
  /** `M_LIMIT_EXCEEDED`: the server wants the client to wait before asking again. */
  RateLimited = 429,
  /** Any other answer, a success to the empty request included. */
  InvalidRequest = 400,
}

/** Registration is open: the server answered 401 with the user-interactive auth flows. */
type OpenRegistration = { status: RegisterFlowStatus.FlowRequired; data: IAuthData };

/** Any other answer is final for the sign-up page and carries no flows. */
type ClosedRegistration = { status: Exclude<RegisterFlowStatus, RegisterFlowStatus.FlowRequired> };

/** The answer to an empty `POST /register` (spec: User-Interactive Authentication API). */
export type RegisterFlowsResponse = OpenRegistration | ClosedRegistration;

export type AuthFlows = { loginFlows: ILoginFlowsResponse; registerFlows: RegisterFlowsResponse };

/** Statuses that end sign-up for good; the page shows them as they are. */
const FINAL_REGISTER_STATUSES = [
  RegisterFlowStatus.Disabled,
  RegisterFlowStatus.RateLimited,
] as const;

/** An empty registration request answers 401 with the server's sign-up flows when sign-up is open. */
const getRegisterFlows = async (client: MatrixClient): Promise<RegisterFlowsResponse> => {
  const invalid: RegisterFlowsResponse = { status: RegisterFlowStatus.InvalidRequest };
  try {
    await client.registerRequest({});
    return invalid;
  } catch (error) {
    const { httpStatus, data } = (error ?? {}) as { httpStatus?: number; data?: IAuthData };
    if (httpStatus === RegisterFlowStatus.FlowRequired && data?.flows) {
      return { status: RegisterFlowStatus.FlowRequired, data };
    }
    const final = FINAL_REGISTER_STATUSES.find((status) => status === httpStatus);
    return final === undefined ? invalid : { status: final };
  }
};

type AuthFlowsLoaderProps = {
  /** Shown while the flows load; a centered spinner when absent. */
  fallback?: () => ReactNode;
  /** Explains a failure above the retry button. */
  error?: (error: unknown) => ReactNode;
  children: (authFlows: AuthFlows) => ReactNode;
};

/** Login flows first: a server without them cannot sign anyone in, so registration is moot. */
const fetchAuthFlows = async (client: MatrixClient): Promise<AuthFlows> => {
  const loginFlows = await client.loginFlows();
  if (!Array.isArray(loginFlows?.flows)) {
    throw new Error('The homeserver returned no login flows.');
  }
  return { loginFlows, registerFlows: await getRegisterFlows(client) };
};

/** Loads the homeserver's login and registration flows for the sign-in pages. */
export function AuthFlowsLoader(props: AuthFlowsLoaderProps) {
  const { fallback, error, children } = props;
  const homeserverUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const client = useMemo(() => createMatrixClient({ baseUrl: homeserverUrl }), [homeserverUrl]);
  const [state, load] = useAsyncCallback(useCallback(() => fetchAuthFlows(client), [client]));
  const { t } = useTranslation();

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
