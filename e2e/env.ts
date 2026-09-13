type Credentials = {
  username: string;
  password: string;
};

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required e2e environment variable: ${name}`);
  }

  return value;
};

export const getHomeserver = (): string =>
  process.env.E2E_HOMESERVER ?? 'http://127.0.0.1:8808';

export const getPrimaryCredentials = (): Credentials => ({
  username: getRequiredEnv('E2E_USERNAME'),
  password: getRequiredEnv('E2E_PASSWORD'),
});

export const getSecondaryCredentials = (): Credentials | undefined => {
  const username = process.env.E2E_SECOND_USERNAME;
  const password = process.env.E2E_SECOND_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error(
      'E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD must both be set to run multi-account e2e tests.'
    );
  }

  return { username, password };
};

export const getThirdCredentials = (): Credentials | undefined => {
  const username = process.env.E2E_THIRD_USERNAME;
  const password = process.env.E2E_THIRD_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error(
      'E2E_THIRD_USERNAME and E2E_THIRD_PASSWORD must both be set to run three-account e2e tests.'
    );
  }

  return { username, password };
};

const buildAuthPath = (
  authRoute: 'login' | 'register' | 'reset-password',
  homeserver: string,
  addAccount = false
): string =>
  `/${authRoute}/${encodeURIComponent(homeserver)}/${addAccount ? '?addAccount=1' : ''}`;

export const buildLoginPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('login', homeserver, addAccount);

export const buildRegisterPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('register', homeserver, addAccount);

export const buildResetPasswordPath = (homeserver: string, addAccount = false): string =>
  buildAuthPath('reset-password', homeserver, addAccount);
