import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/agentStack';

// The `clientConfig` and `clientApiUrl` options of the agent specs' `page` (e2e/helpers/agentStack.ts): top-level
// keys of the client config, and the stack's API as `mindroom.computers.apiUrl`, beside the slot's homeserver and
// the canvases the fixture always sets.
test.describe.configure({ timeout: 300_000 });

/** The client config the page gets, as the fixture routes it. */
const routedConfig = (page: Page) =>
  page.evaluate(async () => (await fetch('/config.json')).json() as Promise<unknown>);

/** The encryption switch of the create room form. */
const encryptionSwitch = (page: Page) =>
  page
    .locator('div')
    .filter({ has: page.getByText('End-to-End Encryption', { exact: true }) })
    .filter({ has: page.getByRole('switch') })
    .last()
    .getByRole('switch');

test.describe('with the options', () => {
  test.use({ clientConfig: { createRoom: { defaultEncryption: false } }, clientApiUrl: true });

  test('the client gets the top-level keys and the API, and keeps the homeserver and canvases', async ({
    page,
    stack,
  }) => {
    await page.goto('/home/create/', { timeout: 180_000 });
    await expect(encryptionSwitch(page)).toHaveAttribute('aria-checked', 'false', {
      timeout: 90_000,
    });
    expect(await routedConfig(page)).toMatchObject({
      homeserverList: [stack.homeserver],
      defaultHomeserver: 0,
      createRoom: { defaultEncryption: false },
      mindroom: { canvas: { enabled: true }, computers: { apiUrl: stack.apiUrl } },
    });
  });
});

test('without the options the client config is the default one', async ({ page, stack }) => {
  await page.goto('/home/create/', { timeout: 180_000 });
  await expect(encryptionSwitch(page)).toHaveAttribute('aria-checked', 'true', {
    timeout: 90_000,
  });
  const config = (await routedConfig(page)) as Record<string, Record<string, unknown>>;
  expect(config).toMatchObject({
    homeserverList: [stack.homeserver],
    mindroom: { canvas: { enabled: true } },
  });
  expect(config.createRoom).toBeUndefined();
  expect(config.mindroom?.computers).not.toEqual({ apiUrl: stack.apiUrl });
});
