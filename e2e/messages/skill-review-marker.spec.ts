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
} from '../helpers/matrix';

// A MindRoom agent's skill review notice (`io.mindroom.skill_review`) is one quiet marker in the
// open thread, without the agent's avatar or name: a mouse hover lists the changed files with
// their line counts, a click opens their diffs below it. An older notice without files lists its
// skills on a click instead. SKILL_REVIEW_SHOTS names a directory for screenshots.
test.use({ viewport: { width: 1280, height: 800 }, video: 'off', trace: 'off' });

const SKILL_DIFF = [
  '@@ -1,4 +1,5 @@',
  ' ---',
  ' name: release-notes',
  '-description: Write release notes',
  '+description: Use when writing release notes for a tagged version',
  ' ---',
  '+Always link the pull requests.',
  '+- **Long lines wrap:** a diff line longer than the panel continues under its text instead of hiding past the right edge, the way code blocks wrap.',
  '',
].join('\n');

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

test('a skill review notice is a quiet marker with files on hover and diffs on click', async ({
  page,
}, testInfo) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const shot = (name: string) =>
    // Disabled animations finish the triggers' highlight transitions before the capture.
    page.screenshot({
      animations: 'disabled',
      path: process.env.SKILL_REVIEW_SHOTS
        ? `${process.env.SKILL_REVIEW_SHOTS}/${name}.png`
        : testInfo.outputPath(`${name}.png`),
    });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await page.addInitScript(() => {
    if (localStorage.getItem('settings')) return;
    localStorage.setItem(
      'settings',
      JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
    );
  });
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const agent = await registerAgentAccount(homeserver, 'code');
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Skill Bot' }),
  });
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: 'Skills',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Please write the release notes for v2026.11.3.',
  });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  const reviewId = await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: '💾 Skill review: updated `release-notes`',
    'io.mindroom.skill_review': {
      changes: { 'release-notes': 'updated' },
      files: [
        {
          skill: 'release-notes',
          path: 'release-notes/SKILL.md',
          action: 'updated',
          added: 2,
          removed: 1,
          diff: SKILL_DIFF,
          diff_truncated: false,
        },
        {
          skill: 'release-notes',
          path: 'release-notes/references/format.md',
          action: 'created',
          added: 2,
          removed: 0,
          diff: '@@ -0,0 +1,2 @@\n+# Format\n+One line per change.\n',
          diff_truncated: false,
        },
      ],
    },
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: '💾 Skill review: updated `changelog`',
    'io.mindroom.skill_review': { changes: { changelog: 'updated' } },
    'm.relates_to': inThread,
  });

  await loginWithPassword(page, { homeserver, ...credentials });
  await openRoute(
    page,
    `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`
  );
  const marker = page.getByRole('button', { name: 'Updated skill release-notes' });
  const legacy = page.getByRole('button', { name: 'Updated skill changelog' });
  await expect(marker).toBeVisible();
  await expect(legacy).toBeVisible();
  // A quiet row: no avatar, no sender line, and the agent's name nowhere in the timeline.
  const row = page.locator(`[data-message-id="${reviewId}"]`);
  await expect(row.locator('[data-message-sender-line], img')).toHaveCount(0);
  await expect(page.locator('[data-message-sender-line]', { hasText: 'Skill Bot' })).toHaveCount(0);
  await shot('collapsed-dark');

  const tooltip = page.getByRole('tooltip');
  await marker.hover();
  await expect(tooltip).toContainText('release-notes/SKILL.md updated +2 −1');
  await expect(tooltip).toContainText('release-notes/references/format.md created +2 −0');
  await shot('hover-dark');

  const panel = page.locator('[data-skill-review-diff]');
  await marker.click();
  await expect(tooltip).toHaveCount(0);
  await expect(marker).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toContainText('-description: Write release notes');
  await expect(panel).toContainText('+description: Use when writing release notes');
  await expect(panel).toContainText('+One line per change.');
  await page.mouse.move(640, 790);
  await shot('expanded-dark');
  // Long lines wrap like a code block's, until the reader turns wrapping off to scroll sideways.
  const diff = panel.getByRole('region', { name: 'Diff of release-notes/SKILL.md' });
  const wrap = panel.getByRole('button', { name: 'Wrap lines' }).first();
  const overflows = () => diff.evaluate((node) => node.scrollWidth > node.clientWidth);
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  expect(await overflows()).toBe(false);
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  expect(await overflows()).toBe(true);
  await page.mouse.move(640, 790);
  await shot('expanded-unwrapped-dark');
  await wrap.click();
  await marker.click();
  await expect(panel).toHaveCount(0);
  await expect(marker).toHaveAttribute('aria-expanded', 'false');

  // The older notice has no files: a click lists its skills.
  await page.mouse.move(640, 790);
  await legacy.click();
  await expect(tooltip).toContainText('changelog updated');
  await expect(page.locator('[data-skill-review-diff]')).toHaveCount(0);

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...settings, themeId: 'light-theme' }));
  });
  await page.reload();
  await expect(marker).toBeVisible({ timeout: 30_000 });
  await marker.click();
  await expect(panel).toBeVisible();
  await expect(marker).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(640, 790);
  await shot('expanded-light');
});
