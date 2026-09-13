import { test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';

test('logs in with password against an explicit homeserver', async ({ page }) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();

  await loginWithPassword(page, {
    homeserver,
    username: credentials.username,
    password: credentials.password,
  });
});
