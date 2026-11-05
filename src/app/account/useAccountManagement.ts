import type { ValidatedAuthMetadata } from 'matrix-js-sdk';
import { parseHttpUrl } from '../lib/httpUrl';

/** Account management actions from MSC4191. */
type AccountManagementAction =
  | 'org.matrix.profile'
  | 'org.matrix.devices_list'
  | 'org.matrix.device_view'
  | 'org.matrix.device_delete'
  | 'org.matrix.account_deactivate'
  | 'org.matrix.cross_signing_reset';

type AccountManagementParams = {
  action: AccountManagementAction | string;
  device_id?: string;
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
