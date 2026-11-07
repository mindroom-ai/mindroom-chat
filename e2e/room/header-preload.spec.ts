import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, joinRoom, registerAgentAccount } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// The room header's call button and Computer button start loading the code of the part they show
// (the call panel, the computer's screen) once the pointer or the focus reaches them, so the click
// does not wait for it. Each test watches the page's requests for that code and never clicks the
// button before it has seen them. The call service and the computer server are only announced to
// the client (`.well-known` and `config.json` answered here), so no call or computer session
// starts. On a production build (scripts/e2e-slot.sh <n> --preview) each part is a chunk of its
// own; on the dev server, a module.
const PASSWORD = 'header-preload-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Nothing listens there: announced servers never answer.
const NOWHERE = 'http://127.0.0.1:9';

// The page's own requests, which a service worker would otherwise make for it.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

/** The requests for a module's code: its chunk in a build (`<name>-<hash>.js`), else its file. */
const watchCode = (page: Page, name: string): string[] => {
  const pattern = new RegExp(`/${name}(?:-[\\w-]+)?\\.(?:js|tsx?)$`);
  const seen: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pattern.test(pathname)) seen.push(pathname);
  });
  return seen;
};

/** Announces a LiveKit call service, so the header offers calls. */
const announceCallService = (context: BrowserContext) =>
  context.route('**/.well-known/matrix/client', (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        'm.homeserver': { base_url: HOMESERVER },
        'org.matrix.msc4143.rtc_foci': [
          { type: 'livekit', livekit_service_url: `${NOWHERE}/livekit` },
        ],
      },
    })
  );

/** Names a computer server in the client's config, so the room offers the computer. */
const configureComputerServer = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const config = await (await route.fetch()).json();
    await route.fulfill({
      json: { ...config, mindroom: { ...config.mindroom, computers: { apiUrl: NOWHERE } } },
    });
  });

/** Signs in a new account and opens its room `name`, with `agent` joined when given. */
const openNewRoom = async (
  page: Page,
  name: string,
  agent?: { userId: string; accessToken: string }
) => {
  const username = `preload_${name.toLowerCase().replaceAll(' ', '_')}_${RUN}`;
  const viewer = await registerDisposableUser(username, PASSWORD);
  const roomId = await createPrivateRoom(HOMESERVER, viewer.accessToken, {
    name,
    topic: `${name} notes`,
    invite: agent ? [agent.userId] : undefined,
  });
  if (agent) await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
};

/** Waits as long as a load at start would take, so an empty list means nothing asked yet. */
const settle = (page: Page) => page.waitForTimeout(1_000);

test('hovering the call button loads the call panel, which the click then opens', async ({
  page,
  context,
}) => {
  await announceCallService(context);
  const panelCode = watchCode(page, 'CallPanel');
  await openNewRoom(page, 'Weekly Sync');
  const callButton = page.locator('[data-room-call-button]');
  await expect(callButton).toBeVisible({ timeout: 60_000 });
  await settle(page);
  expect(panelCode).toEqual([]);

  await callButton.hover();
  await expect.poll(() => panelCode.length).toBe(1);

  await callButton.click();
  await expect(
    page.getByTestId('call-panel').getByRole('button', { name: 'Join', exact: true })
  ).toBeVisible();
  // The panel opened from the code the hover loaded.
  expect(panelCode).toHaveLength(1);
});

test('the focus reaching the call button loads the call panel', async ({ page, context }) => {
  await announceCallService(context);
  const panelCode = watchCode(page, 'CallPanel');
  await openNewRoom(page, 'Design Review');
  const callButton = page.locator('[data-room-call-button]');
  await expect(callButton).toBeVisible({ timeout: 60_000 });
  await settle(page);
  expect(panelCode).toEqual([]);

  await callButton.focus();
  await expect.poll(() => panelCode.length).toBe(1);
});

test('hovering the Computer button loads the computer screen', async ({ page, context }) => {
  const agent = await registerAgentAccount(HOMESERVER, 'desk');
  await configureComputerServer(context);
  const screenCode = watchCode(page, 'ComputerScreen');
  await openNewRoom(page, 'Remote Desk', agent);
  // Until the computer was shown here the room menu offers it; once open, the header has a button.
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Show Computer', exact: true }).click();
  const computerButton = page.getByRole('button', { name: 'Hide Computer', exact: true });
  await expect(computerButton).toBeVisible({ timeout: 30_000 });
  await settle(page);
  // The server never answers, so no screen streamed and nothing asked for its code.
  expect(screenCode).toEqual([]);

  await computerButton.hover();
  await expect.poll(() => screenCode.length).toBe(1);
});
