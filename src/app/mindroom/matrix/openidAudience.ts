import { Method, type IOpenIDToken, type MatrixClient } from 'matrix-js-sdk';

// The Tuwunel fork binds the token to this audience (`io.mindroom.openid_audience`); stock homeservers ignore it.
export const OPENID_AUDIENCE_FIELD = 'io.mindroom.audience';

export const requestAudienceOpenIdToken = (
  mx: MatrixClient,
  audience: string
): Promise<IOpenIDToken> =>
  mx.http.authedRequest<IOpenIDToken>(
    Method.Post,
    `/user/${encodeURIComponent(mx.getSafeUserId())}/openid/request_token`,
    undefined,
    { [OPENID_AUDIENCE_FIELD]: audience }
  );
