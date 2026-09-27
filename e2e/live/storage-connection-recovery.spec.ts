import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devices, expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  sendRoomMessage,
  sendStateEvent,
  type ThreadFixture,
} from '../helpers/matrix';
import {
  canKillWebKitNetworkProcess,
  killWebKitNetworkProcess,
  recordNetworkingProcessResources,
} from '../helpers/networkingProcessLoss';

const openThread = async (
  page: Page,
  name: string,
  options: { encrypted?: boolean; settleMs?: number } = {}
) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const stamp = Date.now();
  const fixture: ThreadFixture = await createThreadFixture(homeserver, session.accessToken, {
    name: `${name} ${stamp}`,
    topic: 'Recover after WebKit networking-process loss',
    rootBody: `${name} root ${stamp}`,
    replyBody: `${name} reply ${stamp}`,
  });
  if (options.encrypted) {
    await sendStateEvent(homeserver, session.accessToken, fixture.roomId, 'm.room.encryption', '', {
      algorithm: 'm.megolm.v1.aes-sha2',
    });
  }
  await recordNetworkingProcessResources(page);
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
    fixture.replyBody,
    { timeout: 60_000 }
  );
  // Let opening settle so the loss hits a thread idling on live sync.
  await page.waitForTimeout(options.settleMs ?? 2_000);
  const sendReply = (body: string) =>
    sendRoomMessage(homeserver, session.accessToken, fixture.roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: fixture.rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: fixture.rootId },
      },
    });
  const countEncrypted = async () => {
    const response = await fetch(
      `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        fixture.roomId
      )}/messages?dir=b&limit=50`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    );
    const body = (await response.json()) as { chunk?: { type: string }[] };
    return (body.chunk ?? []).filter((event) => event.type === 'm.room.encrypted').length;
  };
  return { fixture, stamp, sendReply, countEncrypted };
};

/** After the recovery reload the same thread is open, live, and without the warning. */
const expectRecoveredThread = async (
  page: Page,
  fixture: ThreadFixture,
  sendReply: (body: string) => Promise<string>,
  body: string
) => {
  expect(new URL(page.url()).searchParams.get('threadId')).toBe(fixture.rootId);
  await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('client-storage-status')).toHaveCount(0);
  const replyId = await sendReply(body);
  await expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(body, {
    timeout: 30_000,
  });
};

test.describe('storage connection recovery', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180_000);

  test('reloads an idle open thread after networking-process loss', async ({ page }) => {
    const { fixture, stamp, sendReply } = await openThread(page, 'Storage recovery');

    const reloaded = page.waitForEvent('load');
    const loss = await page.evaluate(() => window.__loseNetworkingProcess?.());
    expect(loss?.ports).toBeGreaterThan(0);
    expect(loss?.connections).toBeGreaterThan(0);
    await reloaded;

    await expectRecoveredThread(page, fixture, sendReply, `Reply after recovery ${stamp}`);
    expect(
      await page.evaluate(() => window.localStorage.getItem('mindroom.storageRecovery.reloadedAt'))
    ).not.toBeNull();
  });

  test('moves an encrypted send stuck by the loss into the composer and sends it after reload', async ({
    page,
  }) => {
    const { fixture, stamp, sendReply, countEncrypted } = await openThread(
      page,
      'Encrypted storage recovery',
      { encrypted: true }
    );
    const composer = page.getByRole('textbox').first();
    const sendButton = page.getByRole('button', { name: 'Send message' });
    const send = async (body: string) => {
      await composer.click();
      await composer.fill(body);
      await sendButton.click();
    };
    await send(`Encrypted before loss ${stamp}`);
    await expect.poll(countEncrypted, { timeout: 30_000 }).toBe(1);

    // Recent input keeps the page from reloading before the send below starts.
    await page.keyboard.press('Shift');
    await page.evaluate(() => window.__loseNetworkingProcess?.());
    const stuckBody = `Encrypted after loss ${stamp}`;
    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await send(stuckBody);
    await reloaded;
    // The closed Rust crypto store never encrypted it.
    expect(await countEncrypted()).toBe(1);

    await expect(composer).toContainText(stuckBody, { timeout: 60_000 });
    await sendButton.click();
    await expect.poll(countEncrypted, { timeout: 30_000 }).toBe(2);
    await expect(page.getByText(stuckBody)).toBeVisible();
    await expectRecoveredThread(
      page,
      fixture,
      sendReply,
      `Reply after encrypted recovery ${stamp}`
    );
  });

  test('recovers from a real WebKit networking-process exit', async ({
    playwright,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== 'webkit',
      'Only WebKit brokers storage through a networking process.'
    );
    // An ephemeral context keeps all storage in the networking process and loses it
    // with the process; the iOS app keeps it on disk like this persistent context.
    const context = await playwright.webkit.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'mindroom-webkit-')),
      { ...devices['Desktop Safari'], baseURL: testInfo.project.use.baseURL }
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // WebKit flushes Web Storage to disk after a delay; unflushed writes die with the process.
      const { fixture, stamp, sendReply } = await openThread(page, 'Real networking loss', {
        settleMs: 5_000,
      });
      test.skip(!canKillWebKitNetworkProcess(), 'The WebKit networking process is not visible.');

      const reloaded = page.waitForEvent('load', { timeout: 60_000 });
      expect(killWebKitNetworkProcess()).toBeGreaterThan(0);
      await reloaded;

      await expectRecoveredThread(page, fixture, sendReply, `Reply after real recovery ${stamp}`);
    } finally {
      await context.close();
    }
  });
});
