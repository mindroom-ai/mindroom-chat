import { expect, test, type Locator, type Page } from '@playwright/test';
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

const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

// A finished agent reply with stored reasoning and two tool calls, then one still thinking.
const FINAL_BODY = ['🔧 `add_memory` [1]', '', '🔧 `send_voice_message` [2]', '', 'Done.'].join(
  '\n'
);

// The header's parts in page coordinates: the bulb, the label, the chevron, and the icon tile of
// the tool row below it.
const headerGeometry = async (reply: Locator) =>
  reply.evaluate((element) => {
    // The tool row's button names its panel; the reasoning toggle has none.
    const toggle = element.querySelector('button[aria-expanded]:not([aria-controls])');
    const [bulb, chevron] = Array.from(toggle?.querySelectorAll('svg') ?? []);
    const label = toggle?.querySelector('span');
    const tile = element.querySelector('button[aria-controls] > span[aria-hidden]');
    const box = (node: Element | null | undefined) => {
      const rect = node?.getBoundingClientRect();
      return rect && { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
    };
    return {
      bulb: box(bulb),
      label: box(label),
      chevron: box(chevron),
      chevronTransform: chevron ? getComputedStyle(chevron).transform : undefined,
      labelFont: label && {
        size: getComputedStyle(label).fontSize,
        weight: getComputedStyle(label).fontWeight,
      },
      toggle: box(toggle),
      toolLine: box(element.querySelector('button[aria-controls]')),
      tile: box(tile),
    };
  });

const setTheme = async (page: Page, themeId: string) => {
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);
  await page.reload();
};

test.describe('agent reasoning header', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');
  // Sharp screenshots to compare with a Retina capture.
  test.use({ deviceScaleFactor: 2 });

  test('shows a bulb, the label and a chevron that turns from along the text to down', async ({
    page,
  }) => {
    test.slow();
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Agent reasoning ${Date.now()}`,
      topic: 'Agent replies with reasoning',
    });
    const agent = await registerAgentAccount(homeserver, 'helper');
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
      method: 'POST',
      accessToken,
      body: JSON.stringify({ user_id: agent.userId }),
    });
    await joinRoom(homeserver, agent.accessToken, roomId);
    await matrixFetch(homeserver, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
      method: 'PUT',
      accessToken: agent.accessToken,
      body: JSON.stringify({ displayname: 'Helper' }),
    });

    const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Remember that today is my first day',
    });
    const thread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: false,
      'm.in_reply_to': { event_id: rootId },
    };
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: FINAL_BODY,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': {
        text: 'The user starts a new job today.\n\nSave it, then answer by voice.',
        duration_ms: 7600,
      },
      'm.relates_to': thread,
    });
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Looking for a good first question.',
      'm.relates_to': thread,
    });

    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    const reply = page.locator('[data-message-item]').filter({ hasText: 'Thought for 8 s' });
    await expect(reply).toHaveCount(1, { timeout: 60_000 });
    const toggle = reply.getByRole('button', { name: 'Thought for 8 s' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle.locator('svg')).toHaveCount(2);
    await expect(toggle.locator('svg[aria-hidden="true"]')).toHaveCount(2);

    // The streaming reply shows the same header, open, with its chevron down.
    const thinking = page.locator('[data-message-item]').filter({ hasText: 'good first question' });
    const thinkingToggle = thinking.getByRole('button', { name: 'Thinking' });
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(thinkingToggle.locator('svg')).toHaveCount(2);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const collapsed = await headerGeometry(reply);
    // eslint-disable-next-line no-console
    console.log('reasoning header geometry', JSON.stringify(collapsed));
    expect(collapsed.chevronTransform).toBe('none');
    expect(collapsed.labelFont).toEqual({ size: '12px', weight: '400' });
    expect(collapsed.toggle?.height).toBeCloseTo(24, 0);
    expect(collapsed.bulb?.height).toBeCloseTo(16, 0);
    expect(collapsed.chevron?.height).toBeCloseTo(16, 0);
    // The bulb starts where the tool row's icon tile starts.
    expect(Math.abs((collapsed.bulb?.left ?? 0) - (collapsed.tile?.left ?? 99))).toBeLessThan(1.5);
    expect((collapsed.label?.left ?? 0) - (collapsed.bulb?.right ?? 0)).toBeCloseTo(4, 0);
    expect((collapsed.chevron?.left ?? 0) - (collapsed.label?.right ?? 0)).toBeCloseTo(4, 0);
    expect((await headerGeometry(thinking)).chevronTransform).toBe('matrix(0, 1, -1, 0, 0, 0)');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(reply).toContainText('Save it, then answer by voice.');
    expect((await headerGeometry(reply)).chevronTransform).toBe('matrix(0, 1, -1, 0, 0, 0)');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Right to left: the collapsed chevron points left, the open one still points down.
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    expect((await headerGeometry(reply)).chevronTransform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    expect((await headerGeometry(thinking)).chevronTransform).toBe('matrix(0, 1, -1, 0, 0, 0)');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));

    if (!SCREENSHOT) return;
    for (const [themeId, scheme] of [
      ['dark-theme', 'dark'],
      ['light-theme', 'light'],
    ] as const) {
      await setTheme(page, themeId);
      await expect(toggle).toBeVisible({ timeout: 60_000 });
      await page.mouse.move(0, 0);
      await reply.screenshot({
        path: `${SCREENSHOT}/L11-reasoning-header-collapsed-${scheme}.png`,
      });
      await toggle.click();
      await expect(reply).toContainText('Save it, then answer by voice.');
      await page.mouse.move(0, 0);
      await reply.screenshot({ path: `${SCREENSHOT}/L11-reasoning-header-expanded-${scheme}.png` });
      await toggle.click();
      await thinking.screenshot({
        path: `${SCREENSHOT}/L11-reasoning-header-thinking-${scheme}.png`,
      });
    }
  });
});
