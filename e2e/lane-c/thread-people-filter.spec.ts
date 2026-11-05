import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

/** A plain account (no agent name) with a display name, as people in the room. */
const registerPerson = async (homeserver: string, displayName: string): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username: `person_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        password: randomUUID(),
        auth: { type: 'm.login.dummy' },
      }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { accessToken: body.access_token, userId: body.user_id };
};

const screenshotBothThemes = async (page: Page, name: string) => {
  if (!SCREENSHOT) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme });
    // The theme change animates its colors; the screenshot waits for those transitions.
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(async () => {
      // The transitions start with the next style update.
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: `${SCREENSHOT}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test.describe('thread People filter', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('keeps the threads the chosen people took part in, searches people, and resets', async ({
    page,
  }) => {
    // Four accounts, five threads and a reload on a loaded machine.
    test.setTimeout(360_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, me.accessToken, {
      name: `People filter ${stamp}`,
      topic: 'Threads with three people and an agent',
    });
    const ada = await registerPerson(homeserver, `Ada ${stamp}`);
    const grace = await registerPerson(homeserver, `Grace ${stamp}`);
    const agent = await registerAgentAccount(homeserver, 'helper');
    for (const member of [ada, grace, agent]) {
      // eslint-disable-next-line no-await-in-loop
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
        method: 'POST',
        accessToken: me.accessToken,
        body: JSON.stringify({ user_id: member.userId }),
      });
      // eslint-disable-next-line no-await-in-loop
      await joinRoom(homeserver, member.accessToken, roomId);
    }

    // Who starts each thread and who replies in it.
    const threads = [
      { title: `Ada asks the agent ${stamp}`, root: ada, reply: agent },
      { title: `Grace asks Ada ${stamp}`, root: grace, reply: ada },
      { title: `I ask the agent ${stamp}`, root: me, reply: agent },
      { title: `I ask Grace ${stamp}`, root: me, reply: grace },
      { title: `I ask the agent again ${stamp}`, root: me, reply: agent },
    ];
    for (const thread of threads) {
      // eslint-disable-next-line no-await-in-loop
      const rootId = await sendRoomMessage(homeserver, thread.root.accessToken, roomId, {
        msgtype: 'm.text',
        body: thread.title,
      });
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, thread.reply.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Reply to ${thread.title}`,
        'm.relates_to': threadRelation(rootId),
      });
    }
    const withAdaOrGrace = threads.slice(0, 2).concat(threads[3]!);
    const withoutThem = [threads[2]!, threads[4]!];

    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const cards = page.locator('[data-compact-room-view] [data-thread-root-id]');
    await expect(cards).toHaveCount(threads.length, { timeout: 60_000 });

    // The People dropdown is one of the advanced filters.
    const overview = page.locator('[data-room-thread-overview]');
    await overview.locator('[data-thread-filter-mode-switch]').click();
    const peopleButton = overview.locator('[data-people-filter-button]');
    await expect(peopleButton).toHaveAttribute('data-people-filter-count', '0');
    await peopleButton.click();
    const panel = overview.locator('[data-people-filter-panel]');
    const search = panel.locator('[data-people-filter-search]');
    await expect(search).toBeFocused();
    const person = (userId: string) => panel.locator(`[data-person-option="${userId}"]`);
    const listed = panel.locator('[data-person-option]');
    await expect(listed).toHaveCount(4);
    await expect(person(agent.userId)).toContainText('Agent');
    await expect(person(ada.userId)).toContainText(`Ada ${stamp}`);

    // The search narrows the list by display name and by Matrix ID.
    await search.fill('grace');
    await expect(listed).toHaveCount(1);
    await expect(person(grace.userId)).toBeVisible();
    await search.fill(ada.userId.slice(1, 12));
    await expect(listed).toHaveCount(1);
    await expect(person(ada.userId)).toBeVisible();
    await search.fill('');
    await expect(listed).toHaveCount(4);

    // Ada or Grace: the threads either of them took part in.
    await person(ada.userId).click();
    await person(grace.userId).click();
    await expect(person(ada.userId).getByRole('checkbox')).toBeChecked();
    await expect(person(grace.userId).getByRole('checkbox')).toBeChecked();
    await expect(cards).toHaveCount(withAdaOrGrace.length);
    for (const thread of withAdaOrGrace) {
      // eslint-disable-next-line no-await-in-loop
      await expect(cards.filter({ hasText: thread.title })).toHaveCount(1);
    }
    for (const thread of withoutThem) {
      // eslint-disable-next-line no-await-in-loop
      await expect(cards.filter({ hasText: thread.title })).toHaveCount(0);
    }
    await expect(peopleButton).toHaveAttribute('data-people-filter-count', '2');
    await screenshotBothThemes(page, 'V6-people-filter-open');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(peopleButton).toBeFocused();
    await peopleButton.blur();
    await page.mouse.move(1, 1);
    await screenshotBothThemes(page, 'V6-people-filter-applied');

    // The header's filter button marks the People filter while the bar is hidden.
    const filterButton = page.locator('[data-thread-filter-bar-toggle]');
    await filterButton.click();
    await expect(page.locator('[data-hidden-filters-dot]')).toBeVisible();
    await expect(cards).toHaveCount(withAdaOrGrace.length);
    await filterButton.click();

    // The choice is stored with the room's other filters.
    await page.reload();
    await expect(cards).toHaveCount(withAdaOrGrace.length, { timeout: 120_000 });
    await expect(peopleButton).toHaveAttribute('data-people-filter-count', '2');

    // Reset (the All preset) clears it.
    await overview.locator('[data-preset-button]').click();
    await overview.locator('[data-preset-option="all"]').click();
    await expect(peopleButton).toHaveAttribute('data-people-filter-count', '0');
    await expect(cards).toHaveCount(threads.length);
  });
});
