import type { Page, Request } from '@playwright/test';
import { logoutActiveAccount } from '../helpers/accounts';
import { expect, openLobby, openNewSession, test, type AgentStack } from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';

// The client SDK's `server` subpath end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack with --client-sessions and
// the sample MindRoom plugin (e2e/fixtures/sample-plugin), whose routes the example's panel calls in
// the stack's lobby as the signed-in user. Its hello, its websocket, an image a route answers and an
// upload that reports its progress share one sign-in. Once the user signed in eight more times
// elsewhere, MindRoom ends the page's session: the socket closes with 4401, the panel opens it
// again, and the next request answers after one new sign-in. Signing out ends the page's session at
// once. Needs both plugins:
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//   E2E_PLUGIN_DIRS=e2e/fixtures/sample-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/plugins/mindroom-server.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);
test.skip(
  !process.env.E2E_PLUGIN_DIRS?.includes('sample-plugin'),
  'needs e2e/fixtures/sample-plugin in E2E_PLUGIN_DIRS'
);

test.use({ agentStackArgs: ['--client-sessions'] });
test.describe.configure({ timeout: 360_000 });

/** The page's requests to the MindRoom server, with their headers. */
const serverRequests = (page: Page, stack: AgentStack) => {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(stack.apiUrl)) seen.push(request);
  });
  const all = () =>
    Promise.all(
      seen.map(async (request) => ({
        method: request.method(),
        path: new URL(request.url()).pathname,
        bearer: (await request.allHeaders()).authorization,
      }))
    );
  return {
    signIns: async () =>
      (await all()).filter(
        ({ method, path }) => method === 'POST' && path === '/api/client-sessions'
      ).length,
    all,
  };
};

/** Signs the tester in to MindRoom's client sessions from outside the page, with a token of its own. */
const signInElsewhere = async (stack: AgentStack) => {
  const openIdToken = await matrixFetch<Record<string, unknown>>(
    stack.homeserver,
    `/user/${encodeURIComponent(stack.tester.userId)}/openid/request_token`,
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({ 'io.mindroom.audience': new URL(stack.apiUrl).origin }),
    }
  );
  const response = await fetch(`${stack.apiUrl}/api/client-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openid_token: openIdToken }),
  });
  expect(response.status).toBe(200);
};

/** What `GET /api/plugins` answers for a session token. */
const pluginsStatus = async (stack: AgentStack, token: string) =>
  (await fetch(`${stack.apiUrl}/api/plugins`, { headers: { Authorization: `Bearer ${token}` } }))
    .status;

test("a plugin's panel calls its MindRoom routes and websocket, signs in again, and signs out", async ({
  browser,
  stack,
}) => {
  // A device of its own, which the test signs out; the stack's saved tester session stays.
  const page = await openNewSession(browser, stack, {});
  const requests = serverRequests(page, stack);
  await openLobby(page, stack);
  await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Example panel', exact: true });

  await expect(panel.getByText('Socket: open')).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect(panel.getByText(`Hello: ${stack.tester.userId}`)).toBeVisible();
  await panel.getByRole('textbox', { name: 'Echo text' }).fill('ping');
  await panel.getByRole('button', { name: 'Echo', exact: true }).click();
  await expect(panel.getByText(`Echo: ${stack.tester.userId}: ping`)).toBeVisible();
  await panel.getByRole('button', { name: 'Show square', exact: true }).click();
  await expect(panel.getByRole('img', { name: 'Square from MindRoom' })).toHaveJSProperty(
    'naturalWidth',
    16
  );
  const upload = Buffer.alloc(2_000_000, 'a');
  await panel
    .getByLabel('Upload file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: upload });
  await expect(panel.getByText(`Uploaded: ${upload.length} bytes`)).toBeVisible();
  // The last progress counts every byte of the multipart body, more than the file.
  const progress = (await panel.getByText(/^Sent: \d+ of \d+$/).textContent()) ?? '';
  const [loaded, total] = (progress.match(/\d+/g) ?? []).map(Number);
  expect(loaded).toBe(total);
  expect(total).toBeGreaterThan(upload.length);
  expect(await requests.signIns()).toBe(1);

  // MindRoom keeps eight sessions per user, so eight more end the page's.
  for (let count = 0; count < 8; count += 1) {
    // eslint-disable-next-line no-await-in-loop
    await signInElsewhere(stack);
  }
  await expect(panel.getByText('Last close: 4401')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText('Socket: open')).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('textbox', { name: 'Echo text' }).fill('again');
  await panel.getByRole('button', { name: 'Echo', exact: true }).click();
  await expect(panel.getByText(`Echo: ${stack.tester.userId}: again`)).toBeVisible();
  const hello = page.waitForResponse((response) => response.url().endsWith('/hello'));
  await panel.getByRole('button', { name: 'Say hello', exact: true }).click();
  expect((await hello).status()).toBe(200);
  expect(await requests.signIns()).toBe(2);

  // The token the page sent last is live until the sign-out ends it.
  const bearer = (await requests.all()).at(-1)?.bearer ?? '';
  const token = bearer.replace(/^Bearer /, '');
  expect(token).not.toBe('');
  expect(await pluginsStatus(stack, token)).toBe(200);

  await logoutActiveAccount(page);
  await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => pluginsStatus(stack, token), { timeout: 15_000 }).toBe(401);
  expect(
    (await requests.all())
      .filter(({ method }) => method === 'DELETE')
      .map(({ bearer: sent }) => sent)
  ).toEqual([bearer]);
  await page.context().close();
});
