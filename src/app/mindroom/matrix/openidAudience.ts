import { Method, type IOpenIDToken, type MatrixClient } from 'matrix-js-sdk';
import { specVersions } from '../../cs-api';

// The Tuwunel fork binds the token to this audience (`io.mindroom.openid_audience`); stock homeservers ignore it.
export const OPENID_AUDIENCE_FIELD = 'io.mindroom.audience';

/** The homeserver advertises this in `/versions` while it binds tokens to the audience they were requested for. */
export const OPENID_AUDIENCE_FEATURE = 'io.mindroom.openid_audience';

const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

/**
 * Ask the homeserver now whether it binds tokens, or undefined when it cannot be asked. The client's
 * cached versions can outlive a rollback, so they never decide this.
 */
export const readOpenIdBinding = (mx: MatrixClient): Promise<boolean | undefined> =>
  specVersions(freshFetch, mx.getHomeserverUrl()).then(
    (versions) => versions.unstable_features?.[OPENID_AUDIENCE_FEATURE] === true,
    () => undefined
  );

/** Whether the homeserver confirms now that it binds tokens; any failure counts as no binding. */
export const confirmOpenIdBinding = async (mx: MatrixClient): Promise<boolean> =>
  (await readOpenIdBinding(mx)) === true;

/**
 * Request a token bound to `audience`. With `requireBinding`, as for an origin an agent published,
 * it is requested only after the homeserver confirms it binds tokens, so it is useless anywhere else.
 */
export const requestAudienceOpenIdToken = async (
  mx: MatrixClient,
  audience: string,
  { requireBinding = false }: { requireBinding?: boolean } = {}
): Promise<IOpenIDToken> => {
  if (requireBinding && !(await confirmOpenIdBinding(mx))) {
    throw new Error('The homeserver does not bind sign-in tokens, so this server is not trusted.');
  }
  return mx.http.authedRequest<IOpenIDToken>(
    Method.Post,
    `/user/${encodeURIComponent(mx.getSafeUserId())}/openid/request_token`,
    undefined,
    { [OPENID_AUDIENCE_FIELD]: audience }
  );
};
