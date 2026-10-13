import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

test.use({ viewport: { width: 1100, height: 900 } });
test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');

const longBody = (label: string) =>
  Array.from({ length: 24 }, (_, index) => `${label} line ${index + 1}`).join('\n');

for (const surface of ['room', 'thread'] as const) {
  test(`${surface}: a long message sent from the composer folds, while a live agent reply opens`, async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
      simpleMode: false,
      expandLongMessagesByDefault: false,
    });
    const agent = await registerAgentAccount(homeserver, 'general');
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Own long message folds ${surface} ${Date.now()}`,
      topic: 'Local own-message collapse check',
      rootBody: 'Own long message folds',
      replyBody: 'Short reply.',
      invite: [agent.userId],
    });
    await joinRoom(homeserver, agent.accessToken, fixture.roomId);
    const sendAgentMessage = (body: string) =>
      sendRoomMessage(homeserver, agent.accessToken, fixture.roomId, {
        msgtype: 'm.text',
        body,
        ...(surface === 'thread'
          ? {
              'm.relates_to': {
                rel_type: 'm.thread',
                event_id: fixture.rootId,
                is_falling_back: true,
                'm.in_reply_to': { event_id: fixture.rootId },
              },
            }
          : {}),
      });

    await loginWithPassword(page, { homeserver, ...credentials });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: session.userId,
      viewMode: surface === 'room' ? 'classic' : 'threaded',
    });
    const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
    await page.goto(
      surface === 'room' ? roomPath : `${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    const timeline = surface === 'thread' ? page.locator('div[data-thread-count]') : page;
    const row = (text: string) => timeline.locator('[data-message-id]').filter({ hasText: text });
    await expect(timeline.locator(`[data-message-id="${fixture.rootId}"]`).first()).toBeVisible();

    // Contrast: a long message that arrives live from an agent still opens once.
    await sendAgentMessage(longBody('Agent'));
    await expect(
      row('Agent line 1').getByRole('button', { name: 'Show less', exact: true })
    ).toBeVisible();

    const composer = page.getByRole('textbox').first();
    await composer.click();
    for (const [index, line] of longBody('Pasted').split('\n').entries()) {
      if (index > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(line);
    }
    await expect(composer).toContainText('Pasted line 24');
    await page.getByRole('button', { name: 'Send message' }).click();

    const ownRow = row('Pasted line 1');
    await expect(ownRow).toHaveAttribute('data-message-id', /^\$/);
    // Sync delivers in order: once this later message renders, the client has processed the
    // server's echo of the sent message, which is where the thread view used to open it.
    await sendAgentMessage('Sync barrier');
    await expect(row('Sync barrier')).toBeVisible();

    const showFull = ownRow.getByRole('button', { name: 'Show full message', exact: true });
    await expect(showFull).toBeVisible();
    expect(
      await showFull.evaluate((button) => {
        const content = document.getElementById(button.getAttribute('aria-controls')!);
        return content ? content.scrollHeight > content.clientHeight + 1 : false;
      })
    ).toBe(true);

    await showFull.click();
    await expect(ownRow.getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
  });
}
