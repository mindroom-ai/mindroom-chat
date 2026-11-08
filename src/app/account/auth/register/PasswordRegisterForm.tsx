import { FormEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, Input, Spinner, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import type { AuthDict, IAuthData, MatrixClient } from 'matrix-js-sdk';
import { PasswordInput } from '../../../ui/PasswordInput';
import { getDeviceDisplayName } from '../authUi';
import { createMatrixClient } from '../../../matrix/client/matrixClientFactory';
import { FieldError } from '../FiledError';
import {
  CustomRegisterResponse,
  RegisterError,
  RegisterResult,
  SignUpInputs,
  SignUpStage,
  chooseSignUpFlow,
  isTokenStage,
  nextSignUpStage,
  planSignUp,
  register,
  useRegisterComplete,
} from './registerUtil';
import { AuthField } from '../AuthField';

const REGISTER_ERROR_KEYS = {
  [RegisterError.UserTaken]: 'sharedUi.passwordRegisterForm.thisUsernameIsAlreadyTaken',
  [RegisterError.UserInvalid]:
    'sharedUi.passwordRegisterForm.thisUsernameContainsInvalidCharacters',
  [RegisterError.UserExclusive]: 'sharedUi.passwordRegisterForm.thisUsernameIsReserved',
  [RegisterError.PasswordWeak]:
    'sharedUi.passwordRegisterForm.weakPasswordPasswordRejectedByServerPleaseChoosingMoreStrongPassword',
  [RegisterError.PasswordShort]:
    'sharedUi.passwordRegisterForm.shortPasswordPasswordRejectedByServerPleaseChoosingMoreLongPassword',
  [RegisterError.InvalidRequest]: 'sharedUi.passwordRegisterForm.failedToRegisterInvalidRequest',
  [RegisterError.Forbidden]:
    'sharedUi.passwordRegisterForm.failedToRegisterTheHomeserverDoesNotPermitRegistration',
  [RegisterError.RateLimited]:
    'sharedUi.passwordRegisterForm.failedToRegisterYourRegisterRequestHasBeenRateLimitedByServer',
  [RegisterError.Unknown]: 'sharedUi.passwordRegisterForm.failedToRegisterUnknownReason',
} as const;

/** Failures of one stage, told apart from the account errors above. */
const STAGE_ERROR_KEYS = {
  token: 'sharedUi.registrationTokenStage.invalidRegistrationTokenProvided',
  terms: 'sharedUi.termsStage.failedToSubmitTermsAndConditionAcceptance',
  email: 'sharedUi.emailStage.failedToSendVerificationEmailRequest',
} as const;

type FormError = { account: RegisterError } | { stage: keyof typeof STAGE_ERROR_KEYS };

type Field = 'username' | 'password' | 'confirm';

/** The field an account error is about; the others show under the form. */
const FIELD_OF_ERROR: Partial<Record<RegisterError, Field>> = {
  [RegisterError.UserTaken]: 'username',
  [RegisterError.UserInvalid]: 'username',
  [RegisterError.UserExclusive]: 'username',
  [RegisterError.PasswordWeak]: 'password',
  [RegisterError.PasswordShort]: 'password',
};

/** Whether this form can complete one of the server's sign-up flows. */
export const canRegisterWithPassword = (authData: IAuthData): boolean =>
  planSignUp(authData) !== undefined;

/** A policy document, opened beside the form so the typed fields stay. */
function PolicyLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** A stage that waits for the user outside this form: an email link or the server's own page. */
type WaitingStep = { kind: 'email'; email: string } | { kind: 'fallback'; url: string };

/** The panel shown while a stage waits for the user; Continue sends the stage, Cancel stops. */
function WaitingPanel({
  step,
  onContinue,
  onCancel,
}: {
  step: WaitingStep;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="300" role="status">
      {step.kind === 'email' ? (
        <Text size="T300">
          {t('sharedUi.emailStage.pleaseCheckYourEmailValue1AndValidateBeforeContinuingFurther', {
            value1: step.email,
          })}
        </Text>
      ) : (
        <>
          <Text size="T300">{t('sharedUi.reCaptchaStage.pleaseCheckTheBoxBelowToProceed')}</Text>
          <Button
            as="a"
            href={step.url}
            target="_blank"
            rel="noreferrer"
            variant="Secondary"
            fill="Soft"
            size="400"
          >
            {/* A brand name, the same in every language. */}
            <Text as="span" size="B400">
              reCAPTCHA
            </Text>
          </Button>
        </>
      )}
      <Box gap="200">
        <Button type="button" variant="Primary" size="400" onClick={onContinue}>
          <Text as="span" size="B400">
            {t('sharedUi.emailStage.continue')}
          </Text>
        </Button>
        <Button type="button" variant="Secondary" fill="Soft" size="400" onClick={onCancel}>
          <Text as="span" size="B400">
            {t('sharedUi.emailStage.cancel')}
          </Text>
        </Button>
      </Box>
    </Box>
  );
}

type StageAnswer = { auth: AuthDict } | 'cancelled';

type SignUpSteps = {
  mx: MatrixClient;
  inputs: SignUpInputs;
  /** Resolves true once the user is back from the email link or the fallback page. */
  waitForUser: (step: WaitingStep) => Promise<boolean>;
};

/** Answers one stage; the email stage asks the server to send its link only once. */
const createStageAnswerer = ({ mx, inputs, waitForUser }: SignUpSteps) => {
  let emailThreepid: { sid: string; client_secret: string } | undefined;
  return async (stage: string, session?: string): Promise<StageAnswer> => {
    if (isTokenStage(stage)) return { auth: { type: stage, token: inputs.token, session } };
    if (stage === SignUpStage.Email) {
      const email = inputs.email ?? '';
      if (!emailThreepid) {
        const clientSecret = mx.generateClientSecret();
        const { sid } = await mx.requestRegisterEmailToken(email, clientSecret, 1);
        emailThreepid = { sid, client_secret: clientSecret };
      }
      if (!(await waitForUser({ kind: 'email', email }))) return 'cancelled';
      return {
        auth: {
          type: stage,
          threepid_creds: emailThreepid,
          threepidCreds: emailThreepid,
          session,
        } as AuthDict,
      };
    }
    if (stage === SignUpStage.ReCaptcha) {
      const url = mx.getFallbackAuthUrl(stage, session ?? '');
      if (!(await waitForUser({ kind: 'fallback', url }))) return 'cancelled';
      // The fallback page completed the stage; the session alone moves the flow on.
      return { auth: { session } };
    }
    // The dummy and terms stages carry nothing but their type.
    return { auth: { type: stage, session } };
  };
};

const stageErrorOf = (stage: string): keyof typeof STAGE_ERROR_KEYS | undefined => {
  if (isTokenStage(stage)) return 'token';
  if (stage === SignUpStage.Terms) return 'terms';
  return undefined;
};

/**
 * Username and password sign-up. The stages the server asks for are answered along the way:
 * dummy and terms directly, a registration token and an email from the form, reCAPTCHA through
 * the server's fallback page.
 */
export function PasswordRegisterForm(props: {
  /** Where the account is created. */
  homeserverUrl: string;
  /** What the empty registration request answered: flows, session and stage parameters. */
  signUpFlows: IAuthData;
  /** Prefills the token field, from an invite link's `?token=`. */
  inviteToken?: string;
}) {
  const { homeserverUrl: baseUrl, signUpFlows: authData, inviteToken } = props;
  const { t, i18n } = useTranslation();
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const plan = useMemo(() => planSignUp(authData, i18n.language), [authData, i18n.language]);
  const [result, setResult] = useState<CustomRegisterResponse>();
  const [error, setError] = useState<FormError>();
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<WaitingStep>();
  const resumeRef = useRef<(proceed: boolean) => void>();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const storeFailed = useRegisterComplete(result);
  const errorField = error && 'account' in error ? FIELD_OF_ERROR[error.account] : undefined;
  const errorMessage =
    error &&
    t('account' in error ? REGISTER_ERROR_KEYS[error.account] : STAGE_ERROR_KEYS[error.stage]);
  // The field in error, a mismatched confirmation or one the server refused, is marked invalid,
  // described by its error, and focused again.
  const invalidField = mismatch ? 'confirm' : errorField;
  const fieldMessage = mismatch
    ? t('sharedUi.passwordRegisterForm.passwordsDoNotMatch')
    : errorMessage;
  const fieldErrorProps = (field: Field) =>
    invalidField === field ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
  const fieldError = (field: Field) =>
    invalidField === field && fieldMessage ? (
      <FieldError id={errorId} message={fieldMessage} />
    ) : null;

  useEffect(() => {
    const refs = { username: usernameRef, password: passwordRef, confirm: confirmRef };
    if (invalidField) refs[invalidField].current?.focus();
  }, [error, invalidField]);

  const waitForUser = (step: WaitingStep) =>
    new Promise<boolean>((resolve) => {
      resumeRef.current = resolve;
      setWaiting(step);
    });
  const resume = (proceed: boolean) => {
    setWaiting(undefined);
    resumeRef.current?.(proceed);
    resumeRef.current = undefined;
  };

  /** Runs the chosen flow stage by stage until the server creates the account or refuses. */
  const signUp = async (data: Record<string, unknown>, inputs: SignUpInputs) => {
    const flow = chooseSignUpFlow(authData, inputs);
    if (!flow) {
      setError({ account: RegisterError.InvalidRequest });
      return;
    }
    const answer = createStageAnswerer({ mx, inputs, waitForUser });
    let attempt: RegisterResult = await register(mx, data);
    let lastStage: string | undefined;
    // Each round completes one stage, so a flow never needs more rounds than it has stages.
    for (let round = 0; attempt.kind === 'uia' && round <= flow.length + 1; round += 1) {
      const stage = nextSignUpStage(flow, attempt.authData);
      const rejected = (attempt.authData as { errcode?: string }).errcode !== undefined;
      if (rejected && stage === lastStage && stage !== SignUpStage.Email) {
        // The server kept the stage open and said why: the token or the terms did not pass.
        const stageError = stage ? stageErrorOf(stage) : undefined;
        setError(stageError ? { stage: stageError } : { account: RegisterError.Forbidden });
        return;
      }
      if (!stage) break;
      // eslint-disable-next-line no-await-in-loop
      const answered = await answer(stage, attempt.authData.session);
      if (answered === 'cancelled') return;
      lastStage = stage;
      // eslint-disable-next-line no-await-in-loop
      attempt = await register(mx, { ...data, auth: answered.auth });
    }
    if (attempt.kind === 'success') setResult({ baseUrl, response: attempt.response });
    else setError({ account: attempt.kind === 'error' ? attempt.error : RegisterError.Unknown });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const read = (name: string) => String(fields.get(name) ?? '');
    const password = read('passwordInput');
    setError(undefined);
    setMismatch(password !== read('confirmPasswordInput'));
    if (password !== read('confirmPasswordInput')) return;
    setBusy(true);
    try {
      await signUp(
        {
          username: read('usernameInput').trim(),
          password,
          initial_device_display_name: getDeviceDisplayName(),
        },
        {
          token: read('tokenInput').trim() || undefined,
          email: read('emailInput').trim() || undefined,
          acceptedTerms: fields.get('termsInput') !== null,
        }
      );
    } catch {
      // Only the email request can throw here: the server would not send its link.
      setError({ stage: 'email' });
    } finally {
      setWaiting(undefined);
      setBusy(false);
    }
  };

  const [firstPolicy, ...otherPolicies] = plan?.terms ?? [];

  return (
    <Box
      as="form"
      direction="Column"
      gap="400"
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
    >
      <AuthField caption={t('sharedUi.passwordRegisterForm.username')}>
        <Input
          ref={usernameRef}
          {...fieldErrorProps('username')}
          autoComplete="username"
          name="usernameInput"
          outlined
          required
          size="500"
          variant={invalidField === 'username' ? 'Critical' : 'Background'}
        />
        {fieldError('username')}
      </AuthField>
      <AuthField caption={t('sharedUi.passwordRegisterForm.password')}>
        <PasswordInput
          ref={passwordRef}
          {...fieldErrorProps('password')}
          autoComplete="new-password"
          name="passwordInput"
          outlined
          required
          size="500"
          variant={invalidField === 'password' ? 'Critical' : 'Background'}
        />
        {fieldError('password')}
      </AuthField>
      <AuthField caption={t('sharedUi.passwordRegisterForm.confirmPassword')}>
        <PasswordInput
          ref={confirmRef}
          {...fieldErrorProps('confirm')}
          autoComplete="new-password"
          name="confirmPasswordInput"
          outlined
          required
          size="500"
          variant={invalidField === 'confirm' ? 'Critical' : 'Background'}
        />
        {fieldError('confirm')}
      </AuthField>
      {plan?.token && (
        <AuthField
          caption={
            plan.token === 'required'
              ? t('sharedUi.passwordRegisterForm.registrationToken')
              : t('sharedUi.passwordRegisterForm.registrationTokenOptional')
          }
        >
          <Input
            name="tokenInput"
            defaultValue={inviteToken}
            autoComplete="off"
            outlined
            required={plan.token === 'required'}
            size="500"
            variant="Background"
          />
        </AuthField>
      )}
      {plan?.email && (
        <AuthField
          caption={
            plan.email === 'required'
              ? t('sharedUi.passwordRegisterForm.email')
              : t('sharedUi.passwordRegisterForm.emailOptional')
          }
        >
          <Input
            name="emailInput"
            type="email"
            autoComplete="email"
            outlined
            required={plan.email === 'required'}
            size="500"
            variant="Background"
          />
        </AuthField>
      )}
      {firstPolicy && (
        <Box direction="Column" gap="100">
          <Box as="label" alignItems="Center" gap="200">
            <Checkbox name="termsInput" required={plan?.termsRequired} variant="Primary" />
            <Text size="T300">
              <Trans
                i18nKey="sharedUi.passwordRegisterForm.acceptTerms"
                components={{ terms: <PolicyLink href={firstPolicy.url} /> }}
              />
            </Text>
          </Box>
          {otherPolicies.map((policy) => (
            <Text key={policy.id} size="T200">
              <PolicyLink href={policy.url}>{policy.name}</PolicyLink>
            </Text>
          ))}
        </Box>
      )}
      {errorMessage && !errorField && <FieldError message={errorMessage} />}
      {storeFailed && (
        <FieldError
          message={t(
            'sharedUi.passwordRegisterForm.registrationSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
          )}
        />
      )}
      {waiting ? (
        <WaitingPanel
          step={waiting}
          onContinue={() => resume(true)}
          onCancel={() => resume(false)}
        />
      ) : (
        <Button
          type="submit"
          variant="Primary"
          size="500"
          disabled={busy}
          before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
        >
          <Text as="span" size="B500">
            {t('sharedUi.passwordRegisterForm.register')}
          </Text>
        </Button>
      )}
    </Box>
  );
}
