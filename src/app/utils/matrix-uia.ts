import { AuthType } from 'matrix-js-sdk';
import { toHttpUrl } from './httpUrl';
import { isRecord } from './isRecord';

// The terms link of the `m.login.terms` stage of user-interactive authentication.

type TermsPolicy = Record<string, unknown>;

/** The URL of the policy's English text, or of its first language. */
const getPolicyUrl = (policy: TermsPolicy): string | undefined => {
  const translations = Object.entries(policy).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      entry[0] !== 'version' && isRecord(entry[1])
  );
  const preferred = translations.find(([language]) => language === 'en') ?? translations[0];
  return preferred ? toHttpUrl(preferred[1].url) : undefined;
};

/**
 * The link for the `m.login.terms` stage: the first policy's URL. Only http and https URLs are
 * returned, so a homeserver cannot make the login page link a script.
 */
export const getLoginTermUrl = (
  params: Record<string, unknown> | undefined
): string | undefined => {
  const terms = params?.[AuthType.Terms];
  if (!isRecord(terms) || !isRecord(terms.policies)) return undefined;
  const policy = Object.values(terms.policies).find(isRecord);
  return policy ? getPolicyUrl(policy) : undefined;
};
