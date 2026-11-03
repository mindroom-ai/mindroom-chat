import { useMemo } from 'react';
import type { ValidatedAuthMetadata } from 'matrix-js-sdk';

/** Account management actions from MSC4191. */
export type AccountManagementAction =
  | 'org.matrix.profile'
  | 'org.matrix.devices_list'
  | 'org.matrix.device_view'
  | 'org.matrix.device_delete'
  | 'org.matrix.account_deactivate'
  | 'org.matrix.cross_signing_reset';

export type AccountManagementParams = {
  action: AccountManagementAction | string;
  device_id?: string;
};

const parseHttpUrl = (url: string | undefined): URL | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The OIDC provider's account management page for `params`, falling back to the issuer.
 * Only http(s) URLs are returned, since the result is opened in a browser.
 */
export const getAccountManagementUrl = (
  authMetadata: ValidatedAuthMetadata,
  params: AccountManagementParams
): string | undefined => {
  const url = parseHttpUrl(authMetadata.account_management_uri ?? authMetadata.issuer);
  if (!url) return undefined;
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, value);
  });
  return url.toString();
};

/** The account management URL for `params`, when the homeserver delegates auth to OIDC. */
export const useAccountManagementUrl = (
  authMetadata: ValidatedAuthMetadata | undefined,
  params: AccountManagementParams
): string | undefined => {
  const { action, device_id: deviceId } = params;
  return useMemo(
    () =>
      authMetadata
        ? getAccountManagementUrl(authMetadata, { action, device_id: deviceId })
        : undefined,
    [authMetadata, action, deviceId]
  );
};
