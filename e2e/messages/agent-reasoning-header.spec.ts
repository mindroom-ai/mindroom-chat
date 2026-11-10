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

// The chevron's transform once it has turned. Under reduced motion, index.css still gives every
// change a 0.01 ms transition, and a read in the frame of the change gets its starting transform.
const turnedChevron = (reply: Locator) =>
  expect.poll(async () => (await headerGeometry(reply)).chevronTransform);

// A private room with the test account and an agent named Helper, and a thread the test account
// starts with `rootBody`. `reply` sends a message of the agent into the thread; `open` signs in and
// shows the thread.
const startAgentThread = async (page: Page, rootBody: string) => {
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
    body: rootBody,
  });
  const thread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: false,
    'm.in_reply_to': { event_id: rootId },
  };
  return {
    reply: (content: Record<string, unknown>) =>
      sendRoomMessage(homeserver, agent.accessToken, roomId, {
        msgtype: 'm.text',
        'm.relates_to': thread,
        ...content,
      }),
    open: async () => {
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    },
  };
};

// MindRoom's formatted body for a reply of tool markers and one-line paragraphs, as the runtime's
// Markdown renderer writes it, with the tool trace of its markers.
const formattedReply = (body: string) => {
  const paragraphs = body.split('\n\n').filter((paragraph) => paragraph.trim());
  const tools = paragraphs.flatMap((paragraph) => /^🔧 `([^`]+)`/.exec(paragraph)?.[1] ?? []);
  return {
    body,
    format: 'org.matrix.custom.html',
    formatted_body: `${paragraphs
      .map((paragraph) => `<p>${paragraph.replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
      .join('\n')}\n`,
    'io.mindroom.tool_trace': {
      version: 2,
      events: tools.map((name) => ({
        type: 'tool_call_completed',
        tool_name: name,
        args_preview: 'text=first day',
        result_preview: 'ok',
      })),
    },
  };
};

// The space between a reply's tool row and what sits around it: the reasoning header and the line
// of text above it, the line of text below it, and the end of the message body. Text is measured by
// its line box, as a paragraph's edge would be.
const toolRowGaps = (reply: Locator, textAbove?: string, textBelow?: string) =>
  reply.evaluate(
    (element, [above, below]) => {
      const row = element.querySelector('button[aria-controls]')?.getBoundingClientRect();
      const line = (text: string | undefined) => {
        if (!text) return undefined;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const start = node.data.indexOf(text);
          if (start >= 0 && node.parentElement) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + text.length);
            const rect = range.getBoundingClientRect();
            const leading =
              (parseFloat(getComputedStyle(node.parentElement).lineHeight) - rect.height) / 2;
            return { top: rect.top - leading, bottom: rect.bottom + leading };
          }
        }
        return undefined;
      };
      const header = element
        .querySelector('button[aria-expanded]:not([aria-controls])')
        ?.getBoundingClientRect();
      const body = element
        .querySelector('button[aria-controls]')
        ?.parentElement?.parentElement?.getBoundingClientRect();
      const lineAbove = line(above);
      const lineBelow = line(below);
      return {
        header: header && row ? row.top - header.bottom : undefined,
        above: lineAbove && row ? row.top - lineAbove.bottom : undefined,
        below: lineBelow && row ? lineBelow.top - row.bottom : undefined,
        end: body && row ? body.bottom - row.bottom : undefined,
      };
    },
    [textAbove, textBelow]
  );

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
    const { reply: sendReply, open } = await startAgentThread(
      page,
      'Remember that today is my first day'
    );
    await sendReply({
      body: FINAL_BODY,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': {
        text: 'The user starts a new job today.\n\nSave it, then answer by voice.',
        duration_ms: 7600,
      },
    });
    await sendReply({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Looking for a good first question.',
    });

    await open();
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
    await turnedChevron(reply).toBe('matrix(0, 1, -1, 0, 0, 0)');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Right to left: the collapsed chevron points left, the open one still points down.
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await turnedChevron(reply).toBe('matrix(-1, 0, 0, -1, 0, 0)');
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

  test('folds long reasoning from the button under it and brings the header back', async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 720 });
    const { reply: sendReply, open } = await startAgentThread(page, 'Plan my first week');
    const steps = Array.from(
      { length: 40 },
      (_, index) => `Step ${index + 1}: weigh what the user needs on day ${index + 1}.`
    );
    await sendReply({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': steps.join('\n\n'),
    });

    await open();
    // Found by its header, which stays when the reasoning folds.
    const reply = page
      .locator('[data-message-item]')
      .filter({ has: page.getByRole('button', { name: 'Thinking' }) });
    await expect(reply).toContainText('Step 40:', { timeout: 60_000 });
    await expect(reply).toHaveCount(1);
    const toggle = reply.getByRole('button', { name: 'Thinking' });
    const collapse = reply.getByRole('button', { name: 'Collapse' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapse).not.toHaveAttribute('aria-expanded');

    // The reader at the end of the reasoning, its header scrolled away above.
    await collapse.scrollIntoViewIfNeeded();
    await expect(collapse).toBeInViewport();
    await expect(toggle).not.toBeInViewport();
    await page.mouse.move(0, 0);
    if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}/reasoning-collapse-end.png` });

    await collapse.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapse).toHaveCount(0);
    await expect(reply).not.toContainText('Step 40:');
    await expect(toggle).toBeFocused();
    await expect(toggle).toBeInViewport();
    await page.mouse.move(0, 0);
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/reasoning-collapse-end-folded.png` });
    }
  });

  // MindRoom writes a blank line around each tool marker. Those lines leave no empty line under the
  // folded tool row: it sits the app's paragraph spacing (8 px) from the reply's text, in the
  // formatted body MindRoom sends and in the body alone, which the app renders the same way.
  test('keeps paragraph spacing between the tool row and the reply text', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 1600 });
    const { reply: sendReply, open } = await startAgentThread(page, 'Save that I start today');
    const shapes = {
      plain: (body: string) => ({ body }),
      formatted: formattedReply,
    };
    const cases = Object.entries(shapes).map(([shape, content]) => ({
      shape,
      toolsThenText: content(
        [`🔧 \`add_memory\` [1]`, '', `🔧 \`send_voice_message\` [2]`, '', `Done ${shape}.`].join(
          '\n'
        )
      ),
      textToolsText: content(
        [`Saving it ${shape}.`, '', `🔧 \`add_memory\` [1]`, '', `Saved ${shape}.`].join('\n')
      ),
      toolsOnly: content(`🔧 \`list_${shape}\` [1]`),
    }));
    for (const shape of cases) {
      await sendReply({
        ...shape.toolsThenText,
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.reasoning': { text: 'Save it, then answer by voice.', duration_ms: 7600 },
      });
      await sendReply({ ...shape.textToolsText, 'io.mindroom.stream_status': 'completed' });
      await sendReply({ ...shape.toolsOnly, 'io.mindroom.stream_status': 'completed' });
    }
    // A reply still running its tool, as MindRoom sends it before the text arrives.
    const runningBody = '🔧 `add_memory` [1] ⏳';
    const streamingId = await sendReply({
      ...formattedReply(runningBody),
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'add_memory', args_preview: 'text=x' }],
      },
      'io.mindroom.stream_status': 'streaming',
    });

    await open();
    const replyWith = (text: string) =>
      page.locator('[data-message-item]').filter({ hasText: text });
    await expect(replyWith('Done plain.')).toHaveCount(1, { timeout: 60_000 });
    const streaming = replyWith('Running 1 tool call');
    await expect(streaming).toHaveCount(1);
    await page.mouse.move(0, 0);

    if (SCREENSHOT) {
      const boxes = await Promise.all(
        ['Done plain.', 'Saved plain.', 'list_plain'].map((text) => replyWith(text).boundingBox())
      );
      const top = Math.min(...boxes.map((box) => box?.y ?? 0));
      const bottom = Math.max(...boxes.map((box) => (box?.y ?? 0) + (box?.height ?? 0)));
      const box = boxes[0];
      await page.screenshot({
        path: `${SCREENSHOT}/L16-tool-row-gap.png`,
        clip: { x: box?.x ?? 0, y: top, width: box?.width ?? 0, height: bottom - top },
      });
    }

    const GAP = 8;
    for (const { shape } of cases) {
      const toolsThenText = await toolRowGaps(
        replyWith(`Done ${shape}.`),
        undefined,
        `Done ${shape}.`
      );
      expect.soft(toolsThenText.header, `${shape}: reasoning header to tool row`).toBeCloseTo(4, 0);
      expect
        .soft(Math.abs((toolsThenText.below ?? 99) - GAP), `${shape}: tool row to text`)
        .toBeLessThanOrEqual(2);
      const textToolsText = await toolRowGaps(
        replyWith(`Saved ${shape}.`),
        `Saving it ${shape}.`,
        `Saved ${shape}.`
      );
      expect
        .soft(Math.abs((textToolsText.above ?? 99) - GAP), `${shape}: text to tool row`)
        .toBeLessThanOrEqual(2);
      expect
        .soft(Math.abs((textToolsText.below ?? 99) - GAP), `${shape}: tool row to text`)
        .toBeLessThanOrEqual(2);
      const toolsOnly = await toolRowGaps(replyWith(`list_${shape}`));
      expect
        .soft(Math.abs(toolsOnly.end ?? 99), `${shape}: tool row to the end of the body`)
        .toBeLessThanOrEqual(2);
    }

    // While the tool runs, only the responding indicator follows its row: no empty line or
    // paragraph. Text that arrives sits the paragraph spacing below the row, while the reply still
    // streams and once it completes.
    const afterRow = await streaming.evaluate((element) => {
      const activity = element.querySelector('button[aria-controls]')?.parentElement;
      const nodes: string[] = [];
      for (let node = activity?.nextSibling; node; node = node.nextSibling) {
        if (node instanceof Element) nodes.push(node.getAttribute('role') ?? node.tagName);
        else if (node.textContent?.trim()) nodes.push('text');
      }
      return nodes;
    });
    expect.soft(afterRow).toEqual(['status']);
    const edit = async (body: string, status: string) => {
      const content = {
        msgtype: 'm.text',
        ...formattedReply(body),
        'io.mindroom.stream_status': status,
      };
      await sendReply({
        ...content,
        body: `* ${body}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: streamingId },
      });
    };
    for (const [text, status] of [
      ['Stored', 'streaming'],
      ['Stored it for you.', 'completed'],
    ] as const) {
      await edit(['🔧 `add_memory` [1]', '', text].join('\n'), status);
      const arrived = replyWith(text);
      await expect(arrived).toHaveCount(1, { timeout: 30_000 });
      const gaps = await toolRowGaps(arrived, undefined, text);
      expect
        .soft(Math.abs((gaps.below ?? 99) - GAP), `${status}: tool row to text`)
        .toBeLessThanOrEqual(2);
    }
  });
});
