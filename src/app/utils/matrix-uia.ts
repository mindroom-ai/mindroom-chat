import { AuthType, type IAuthData, type UIAFlow } from 'matrix-js-sdk';

// Helpers for user-interactive authentication (client-server specification, "User-Interactive
// Authentication API"): flows, completed stages and the parameters of each stage.

export const getSupportedUIAFlows = (flows: UIAFlow[], supportedStages: string[]): UIAFlow[] => {
  const supported = new Set(supportedStages);
  return flows.filter((flow) => flow.stages.every((stage) => supported.has(stage)));
};

export const getUIACompleted = (authData: IAuthData): string[] => authData.completed ?? [];

/** The stages of `flow` not completed yet, in order. */
export const getUIAFlowStages = (flow: UIAFlow, completed: string[] = []): string[] =>
  flow.stages.filter((stage) => !completed.includes(stage));

export const hasStageInFlows = (flows: UIAFlow[], stage: string): boolean =>
  flows.some((flow) => flow.stages.includes(stage));

export const requiredStageInFlows = (flows: UIAFlow[], stage: string): boolean =>
  flows.length > 0 && flows.every((flow) => flow.stages.includes(stage));

// A failed stage answers 401 with the auth data plus the usual `errcode` and `error`.
type IAuthDataWithError = IAuthData & { errcode?: unknown; error?: unknown };

export const getUIAError = (authData: IAuthDataWithError): string | undefined =>
  typeof authData.error === 'string' ? authData.error : undefined;

export const getUIAErrorCode = (authData: IAuthDataWithError): string | undefined =>
  typeof authData.errcode === 'string' ? authData.errcode : undefined;

type TermsPolicy = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
};

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
