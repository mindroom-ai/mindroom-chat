import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { hidePage, recordNetworkingProcessResources } from '../helpers/networkingProcessLoss';

test.describe('storage connection recovery', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180_000);

  test('keeps the open thread live after networking-process loss and reloads when hidden', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Storage recovery ${stamp}`,
      topic: 'Recover after WebKit networking-process loss',
      rootBody: `Storage recovery root ${stamp}`,
      replyBody: `Reply before storage loss ${stamp}`,
    });
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

    await recordNetworkingProcessResources(page);
    await loginWithPassword(page, { homeserver, ...credentials });
    const threadUrl = `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(
      fixture.rootId
    )}`;
    await page.goto(threadUrl);
    await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
      fixture.replyBody,
      { timeout: 60_000 }
    );
    // Let opening settle so the loss hits a thread idling on live sync.
    await page.waitForTimeout(2_000);

    const loss = await page.evaluate(() => window.__loseNetworkingProcess?.());
    expect(loss?.ports).toBeGreaterThan(0);
    expect(loss?.connections).toBeGreaterThan(0);

    const status = page.getByTestId('client-storage-status');
    await expect(status).toContainText('MindRoom will reload when you leave it.');

    const liveBody = `Reply after storage loss ${stamp}`;
    const liveId = await sendReply(liveBody);
    await expect(page.locator(`[data-message-id="${liveId}"]`)).toContainText(liveBody, {
      timeout: 15_000,
    });

    const reloaded = page.waitForEvent('load');
    await hidePage(page);
    await reloaded;

    expect(new URL(page.url()).searchParams.get('threadId')).toBe(fixture.rootId);
    await expect(page.locator(`[data-message-id="${liveId}"]`)).toContainText(liveBody, {
      timeout: 60_000,
    });
    await expect(status).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.sessionStorage.getItem('mindroom.storageRecovery.reloadedAt')
      )
    ).not.toBeNull();

    const afterBody = `Reply after recovery reload ${stamp}`;
    const afterId = await sendReply(afterBody);
    await expect(page.locator(`[data-message-id="${afterId}"]`)).toContainText(afterBody, {
      timeout: 15_000,
    });
  });

  test('moves an encrypted send stuck by the loss into the composer and sends it after reload', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Encrypted storage recovery ${stamp}`,
      topic: 'Recover encrypted sends after WebKit networking-process loss',
      rootBody: `Encrypted recovery root ${stamp}`,
      replyBody: `Encrypted recovery reply ${stamp}`,
    });
    await sendStateEvent(homeserver, session.accessToken, fixture.roomId, 'm.room.encryption', '', {
      algorithm: 'm.megolm.v1.aes-sha2',
    });
    const encryptedCount = async () => {
      const response = await fetch(
        `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
          fixture.roomId
        )}/messages?dir=b&limit=50`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } }
      );
      const body = (await response.json()) as { chunk?: { type: string }[] };
      return (body.chunk ?? []).filter((event) => event.type === 'm.room.encrypted').length;
    };

    await recordNetworkingProcessResources(page);
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toBeVisible({
      timeout: 60_000,
    });
    const composer = page.getByRole('textbox').first();
    const sendButton = page.getByRole('button', { name: 'Send message' });
    const send = async (body: string) => {
      await composer.click();
      await composer.fill(body);
      await sendButton.click();
    };

    await send(`Encrypted before loss ${stamp}`);
    await expect.poll(encryptedCount, { timeout: 30_000 }).toBe(1);

    await page.evaluate(() => window.__loseNetworkingProcess?.());
    await expect(page.getByTestId('client-storage-status')).toBeVisible();
    const stuckBody = `Encrypted after loss ${stamp}`;
    await send(stuckBody);
    // The closed Rust crypto store cannot encrypt it; wait past the in-flight grace period.
    await page.waitForTimeout(11_000);
    expect(await encryptedCount()).toBe(1);

    const reloaded = page.waitForEvent('load');
    await hidePage(page);
    await reloaded;

    await expect(composer).toContainText(stuckBody, { timeout: 60_000 });
    await sendButton.click();
    await expect.poll(encryptedCount, { timeout: 30_000 }).toBe(2);
    await expect(page.getByText(stuckBody)).toBeVisible();
  });
});
