import type {
  IAuthData,
  MatrixClient,
  MatrixError,
  RegisterRequest,
  RegisterResponse,
} from 'matrix-js-sdk';
import { toHttpUrl } from '../../../utils/httpUrl';
import { CompletedAuth, useCompleteSession } from '../completeSession';

/** A finished registration: the new account's credentials and its homeserver URL. */
export type CustomRegisterResponse = CompletedAuth<RegisterResponse>;

/** Why a sign-up failed: the username, the password, or neither of them. */
export const RegisterError = {
  UserExclusive: 'UserExclusive',
  UserInvalid: 'UserInvalid',
  UserTaken: 'UserTaken',
  PasswordShort: 'PasswordShort',
  PasswordWeak: 'PasswordWeak',
  Forbidden: 'Forbidden',
  InvalidRequest: 'InvalidRequest',
  RateLimited: 'RateLimited',
  Unknown: 'Unknown',
} as const;
export type RegisterError = (typeof RegisterError)[keyof typeof RegisterError];

/** One step of a sign-up: done, another auth stage to answer, or a failure. */
export type RegisterResult =
  | { kind: 'success'; response: RegisterResponse }
  | { kind: 'uia'; authData: IAuthData }
  | { kind: 'error'; error: RegisterError; message?: string };

const REGISTER_ERRORS: Record<string, RegisterError> = {
  M_USER_IN_USE: RegisterError.UserTaken,
  M_INVALID_USERNAME: RegisterError.UserInvalid,
  M_EXCLUSIVE: RegisterError.UserExclusive,
  M_WEAK_PASSWORD: RegisterError.PasswordWeak,
  M_PASSWORD_TOO_SHORT: RegisterError.PasswordShort,
  M_FORBIDDEN: RegisterError.Forbidden,
  M_LIMIT_EXCEEDED: RegisterError.RateLimited,
  M_BAD_JSON: RegisterError.InvalidRequest,
  M_NOT_JSON: RegisterError.InvalidRequest,
};

const isUiaResponse = (error: Partial<MatrixError>): boolean =>
  error.httpStatus === 401 &&
  typeof error.data === 'object' &&
  error.data !== null &&
  Array.isArray((error.data as IAuthData).flows);

/**
 * Sends one registration request. A 401 with flows means the server wants
 * another user-interactive auth stage; the caller answers with `data.auth`.
 * Every request asks for a refresh token.
 */
export const register = async (
  mx: MatrixClient,
  data: RegisterRequest
): Promise<RegisterResult> => {
  try {
    const response = await mx.registerRequest({ ...data, refresh_token: true });
    return { kind: 'success', response };
  } catch (error) {
    const matrixError = (error ?? {}) as Partial<MatrixError>;
    if (isUiaResponse(matrixError)) {
      return { kind: 'uia', authData: matrixError.data as IAuthData };
    }
    return {
      kind: 'error',
      error: REGISTER_ERRORS[matrixError.errcode ?? ''] ?? RegisterError.Unknown,
      message: matrixError.message,
    };
  }
};

/** Finishes a registration: stores the session and leaves the register page. */
export const useRegisterComplete = (data?: CustomRegisterResponse): boolean =>
  useCompleteSession(data);

// Sign-up stages this client can answer ("User-interactive authentication API", "Authentication
// types"). reCAPTCHA has no form here; the homeserver's own fallback page asks it.
export const SignUpStage = {
  Dummy: 'm.login.dummy',
  Email: 'm.login.email.identity',
  ReCaptcha: 'm.login.recaptcha',
  Terms: 'm.login.terms',
  Token: 'm.login.registration_token',
  /** MSC3231, the name servers used before the registration token stage was stable. */
  TokenUnstable: 'org.matrix.msc3231.login.registration_token',
} as const;

const KNOWN_STAGES: ReadonlySet<string> = new Set(Object.values(SignUpStage));

export const isTokenStage = (stage: string): boolean =>
  stage === SignUpStage.Token || stage === SignUpStage.TokenUnstable;

/** Whether a sign-up form asks for a value: in every flow, in some, or never. */
export type SignUpField = 'required' | 'optional' | undefined;

/** A policy the `m.login.terms` stage asks the user to accept, in one language. */
export type TermsPolicy = { id: string; name: string; url: string };

/** What the sign-up form shows for the flows a homeserver offers. */
export type SignUpPlan = {
  token: SignUpField;
  email: SignUpField;
  /** The policies to accept; empty when no usable flow has a terms stage. */
  terms: TermsPolicy[];
  termsRequired: boolean;
};

const usableFlows = (authData: IAuthData): string[][] =>
  (authData.flows ?? [])
    .map((flow) => flow.stages)
    .filter((stages) => stages.every((stage) => KNOWN_STAGES.has(stage)));

const fieldNeed = (flows: string[][], needs: (stage: string) => boolean): SignUpField => {
  const asking = flows.filter((stages) => stages.some(needs)).length;
  if (asking === 0) return undefined;
  return asking === flows.length ? 'required' : 'optional';
};

type PolicyParams = Record<string, unknown> & { version?: string };

/** Reads `params["m.login.terms"].policies`, picking the app language and else English. */
const readPolicies = (authData: IAuthData, language: string): TermsPolicy[] => {
  const params = authData.params?.[SignUpStage.Terms] as
    | { policies?: Record<string, PolicyParams> }
    | undefined;
  const [baseLanguage = language] = language.split('-');
  return Object.entries(params?.policies ?? {}).flatMap(([id, policy]) => {
    const translations = Object.entries(policy).filter(([key]) => key !== 'version');
    const pick = (lang: string) => translations.find(([key]) => key === lang)?.[1];
    const chosen = (pick(language) ?? pick(baseLanguage) ?? pick('en') ?? translations[0]?.[1]) as
      | { name?: unknown; url?: unknown }
      | undefined;
    // The URL becomes a link on the sign-up page, so it must be http or https.
    const url = toHttpUrl(chosen?.url);
    if (!chosen || !url) return [];
    return [{ id, name: typeof chosen.name === 'string' ? chosen.name : id, url }];
  });
};

/** The fields the form needs; `undefined` when no flow uses only stages this client knows. */
export const planSignUp = (authData: IAuthData, language = 'en'): SignUpPlan | undefined => {
  const flows = usableFlows(authData);
  if (flows.length === 0) return undefined;
  const needsTerms = fieldNeed(flows, (stage) => stage === SignUpStage.Terms);
  return {
    token: fieldNeed(flows, isTokenStage),
    email: fieldNeed(flows, (stage) => stage === SignUpStage.Email),
    terms: needsTerms ? readPolicies(authData, language) : [],
    termsRequired: needsTerms === 'required',
  };
};

/** What the user filled in that some stages need. */
export type SignUpInputs = { token?: string; email?: string; acceptedTerms?: boolean };

/**
 * The flow to sign up with: one whose stages the inputs can answer, preferring the flow that
 * uses the most of what the user gave (an optional token may unlock more), then the shortest.
 */
export const chooseSignUpFlow = (
  authData: IAuthData,
  inputs: SignUpInputs
): string[] | undefined => {
  const answerable = (stage: string): boolean => {
    if (isTokenStage(stage)) return !!inputs.token;
    if (stage === SignUpStage.Email) return !!inputs.email;
    if (stage === SignUpStage.Terms) return !!inputs.acceptedTerms;
    return true;
  };
  const used = (stages: string[]): number =>
    stages.filter((stage) => isTokenStage(stage) || stage === SignUpStage.Email).length;
  return usableFlows(authData)
    .filter((stages) => stages.every(answerable))
    .sort((a, b) => used(b) - used(a) || a.length - b.length)[0];
};

/** The first stage of `flow` the server has not marked completed yet. */
export const nextSignUpStage = (flow: string[], authData: IAuthData): string | undefined =>
  flow.find((stage) => !(authData.completed ?? []).includes(stage));
