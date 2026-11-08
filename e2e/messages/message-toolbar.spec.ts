import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  buildLoginPath,
  getHomeserver,
  getPrimaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { activeAccountButton } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

// The hover toolbar of a message is a glass pill of quiet icon buttons: every button 32 px
// square and transparent until hovered, 2 px apart, inside an even 4 px of padding and the
// pill's 1 px rim, with corners concentric to the buttons'. Under a thread's banner it keeps
// 8 px below the `[+all]` toggle. Set MESSAGE_TOOLBAR_SHOTS=<directory> to also save close crops
// at rest and with a button hovered, in dark and light themes.
const SHOTS = process.env.MESSAGE_TOOLBAR_SHOTS;

const ROOT = 'Which of these should we ship first?';
const FIRST_REPLY = 'The reply icon sits where the arrow points.';
const SECOND_REPLY = 'Hover me to see the toolbar.';

const BUTTON = 32;
const PADDING = 4;
const RIM = 1;
const GAP = 2;
const TOGGLE_GAP = 8;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** The opacity of a computed colour such as `color(srgb 0.2 0.2 0.2 / 0.9)`. */
const alpha = (colour: string) => Number(/\/\s*([\d.]+)\)$/.exec(colour)?.[1] ?? 1);

/** The toolbar of `row` in page coordinates, with the parts that make its spacing. */
const toolbarGeometry = (row: Locator) =>
  row.evaluate((rowElement) => {
    const reply = rowElement.querySelector('button[aria-label="Reply"]')!;
    const bar = reply.parentElement!;
    const pill = bar.parentElement!;
    const box = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const pillRect = pill.getBoundingClientRect();
    const buttons = Array.from(bar.querySelectorAll('button')).map((button) => {
      const rect = button.getBoundingClientRect();
      const svg = button.querySelector('svg')!;
      // The drawn glyph, not the 24 unit box around it.
      const corners = Array.from(svg.querySelectorAll('path, rect')).flatMap((shape) => {
        const graphic = shape as SVGGraphicsElement;
        const local = graphic.getBBox();
        const ctm = graphic.getScreenCTM()!;
        return [
          new DOMPoint(local.x, local.y).matrixTransform(ctm),
          new DOMPoint(local.x + local.width, local.y + local.height).matrixTransform(ctm),
        ];
      });
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      const style = getComputedStyle(button);
      return {
        label: button.getAttribute('aria-label'),
        box: box(rect),
        radius: Number.parseFloat(style.borderTopLeftRadius),
        background: style.backgroundColor,
        outline: style.outlineStyle,
        // How far the glyph's centre sits from the button's, in pixels.
        inkOffset: {
          x: (Math.min(...xs) + Math.max(...xs)) / 2 - (rect.left + rect.width / 2),
          y: (Math.min(...ys) + Math.max(...ys)) / 2 - (rect.top + rect.height / 2),
        },
      };
    });
    const pillStyle = getComputedStyle(pill);
    // Left to right on screen, which right-to-left layouts reverse.
    const onScreen = buttons.map((b) => b.box).sort((a, b) => a.left - b.left);
    const first = onScreen[0]!;
    const last = onScreen[onScreen.length - 1]!;
    const toggle = document.querySelector('[data-timeline-overlay] button');
    return {
      pill: box(pillRect),
      pillRadius: Number.parseFloat(pillStyle.borderTopLeftRadius),
      pillPadding: pillStyle.padding,
      pillBorder: pillStyle.borderTopWidth,
      pillBackground: pillStyle.backgroundColor,
      rim: getComputedStyle(pill, '::before').backgroundImage,
      inset: {
        start: first.left - pillRect.left,
        end: pillRect.right - last.right,
        top: Math.min(...buttons.map((b) => b.box.top)) - pillRect.top,
        bottom: pillRect.bottom - Math.max(...buttons.map((b) => b.box.bottom)),
      },
      gaps: onScreen.slice(1).map((b, i) => b.left - onScreen[i]!.right),
      buttons,
      row: box(rowElement.getBoundingClientRect()),
      toggle: toggle ? box(toggle.getBoundingClientRect()) : undefined,
    };
  });

type Geometry = Awaited<ReturnType<typeof toolbarGeometry>>;

/** One square size, an even inset, even gaps and concentric corners. */
const expectBalanced = ({
  inset,
  gaps,
  buttons,
  pillRadius,
  pillPadding,
  pillBorder,
}: Geometry) => {
  expect(pillPadding).toBe(`${PADDING}px`);
  expect(pillBorder).toBe(`${RIM}px`);
  for (const side of Object.values(inset)) expect(side).toBeCloseTo(PADDING + RIM, 1);
  for (const gap of gaps) expect(gap).toBeCloseTo(GAP, 1);
  for (const { box } of buttons) {
    expect(box.width).toBeCloseTo(BUTTON, 1);
    expect(box.height).toBeCloseTo(BUTTON, 1);
  }
  expect(pillRadius).toBeCloseTo(buttons[0]!.radius + PADDING + RIM, 1);
};

/** Signs in through the login page; a loaded machine can take a minute to show the shell. */
const signIn = async (page: Page, homeserver: string, username: string, password: string) => {
  await page.goto(buildLoginPath(homeserver));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 120_000,
  });
};

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

const pointAt = async (page: Page, target: Locator) => {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};

/** A close crop of the toolbar, the `[+all]` toggle above it and, with `above`, its tooltip. */
const cropAround = ({ pill, toggle }: Geometry, above = 0) => {
  const top = Math.min(pill.top, toggle?.top ?? pill.top) - 16 - above;
  const left = pill.left - 140;
  return { x: left, y: top, width: pill.right + 24 - left, height: pill.bottom + 28 - top };
};

test.describe('message hover toolbar', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');
  // Sharp crops to compare with a Retina capture.
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

  test('is a balanced pill of quiet icon buttons', async ({ page }) => {
    test.setTimeout(300_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Toolbar ${Date.now()}`,
      topic: 'The message hover toolbar',
    });
    const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: ROOT,
    });
    const thread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    for (const body of [FIRST_REPLY, SECOND_REPLY]) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, accessToken, roomId, {
        msgtype: 'm.text',
        body,
        'm.relates_to': thread,
      });
    }

    await signIn(page, homeserver, credentials.username, credentials.password);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    const rows = page.locator('[data-message-item]');
    const firstRow = rows.filter({ hasText: ROOT });
    const plainRow = rows.filter({ hasText: SECOND_REPLY });
    await expect(plainRow).toBeVisible({ timeout: 60_000 });
    const tooltip = page.getByRole('tooltip');

    // A row with room above it: the pill covers the top 6 px of the row, at its end.
    await plainRow.hover();
    const reaction = plainRow.getByRole('button', { name: 'Add Reaction', exact: true });
    await expect(reaction).toBeVisible();
    const plain = await toolbarGeometry(plainRow);
    expectBalanced(plain);
    expect(plain.pill.right).toBeCloseTo(plain.row.right, 1);
    expect(plain.row.top - plain.pill.top).toBeCloseTo(36, 1);
    // The buttons have no tile of their own while the pointer rests on the message.
    expect(plain.buttons.map((b) => b.background)).toEqual(plain.buttons.map(() => TRANSPARENT));
    // Every glyph's centre is within 0.75 px of its button's; the reply arrow sits on it.
    for (const { inkOffset } of plain.buttons) {
      expect(Math.abs(inkOffset.x)).toBeLessThanOrEqual(0.76);
      expect(Math.abs(inkOffset.y)).toBeLessThanOrEqual(0.76);
    }
    const replyInk = plain.buttons.find((b) => b.label === 'Reply')!.inkOffset;
    expect(Math.abs(replyInk.y)).toBeLessThan(0.1);

    // Hovering one button tints it alone, and its tooltip names it.
    await pointAt(page, reaction);
    await expect(tooltip).toHaveText('Add Reaction');
    const hovered = await toolbarGeometry(plainRow);
    const hoverTint = hovered.buttons[0]!.background;
    expect(hoverTint).not.toBe(TRANSPARENT);
    expect(hovered.buttons.slice(1).map((b) => b.background)).toEqual(
      hovered.buttons.slice(1).map(() => TRANSPARENT)
    );

    // Keyboard focus shows the ring and the same tint.
    await reaction.focus();
    await page.keyboard.press('Tab');
    const reply = plainRow.getByRole('button', { name: 'Reply', exact: true });
    await expect(reply).toBeFocused();
    const focused = (await toolbarGeometry(plainRow)).buttons[1]!;
    expect(focused.outline).not.toBe('none');
    expect(focused.background).toBe(hoverTint);

    // The toolbar stays while its menu is open, and the open menu's button keeps a stronger tint.
    const more = plainRow.getByRole('button', { name: 'More Options', exact: true });
    const copyLink = page.getByRole('menuitem', { name: 'Copy Link', exact: true });
    await more.click();
    await expect(more).toHaveAttribute('aria-pressed', 'true');
    await expect(copyLink).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(more).toBeVisible();
    const open = await toolbarGeometry(plainRow);
    const pressedTint = open.buttons.at(-1)!.background;
    expect(pressedTint).not.toBe(TRANSPARENT);
    expect(pressedTint).not.toBe(hoverTint);
    await page.keyboard.press('Escape');
    await expect(copyLink).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // The first row under the banner moves its toolbar 8 px below `[+all]`, which ends above the
    // row, so the pointer never leaves the row on its way to the toolbar.
    await firstRow.hover();
    await expect(firstRow.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
    const underToggle = await toolbarGeometry(firstRow);
    expectBalanced(underToggle);
    expect(underToggle.toggle).toBeDefined();
    expect(underToggle.pill.top - underToggle.toggle!.bottom).toBeCloseTo(TOGGLE_GAP, 0);
    expect(underToggle.toggle!.bottom).toBeLessThanOrEqual(underToggle.row.top);
    await page.mouse.move(0, 0);

    // Right to left: the pill sits at the row's start, the reply arrow mirrors and stays centred.
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await plainRow.hover();
    await expect(reaction).toBeVisible();
    const rtl = await toolbarGeometry(plainRow);
    expectBalanced(rtl);
    expect(rtl.pill.left).toBeCloseTo(rtl.row.left, 1);
    const rtlReply = rtl.buttons.find((b) => b.label === 'Reply')!.inkOffset;
    expect(rtlReply.x).toBeCloseTo(-replyInk.x, 1);
    expect(Math.abs(rtlReply.y)).toBeLessThan(0.1);
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));
    await page.mouse.move(0, 0);

    for (const [themeId, scheme] of [
      ['dark-theme', 'dark'],
      ['light-theme', 'light'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await setTheme(page, themeId);
      // eslint-disable-next-line no-await-in-loop
      await expect(plainRow).toBeVisible({ timeout: 60_000 });
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(0, 0);
      // Rest the pointer on the message text, away from the buttons.
      // eslint-disable-next-line no-await-in-loop
      await pointAt(page, firstRow.getByText(ROOT, { exact: true }));
      const firstReply = firstRow.getByRole('button', { name: 'Reply', exact: true });
      // eslint-disable-next-line no-await-in-loop
      await expect(firstReply).toBeVisible();
      // eslint-disable-next-line no-await-in-loop
      const geometry = await toolbarGeometry(firstRow);
      // The pill keeps its glass rim in both themes, and a tint dense enough that the row's text
      // under the transparent buttons does not show through.
      expect(geometry.rim).toContain('linear-gradient');
      expect(alpha(geometry.pillBackground)).toBeGreaterThanOrEqual(0.9);
      if (!SHOTS) continue;
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({
        path: `${SHOTS}/L15-message-toolbar-${scheme}.png`,
        clip: cropAround(geometry),
      });
      // eslint-disable-next-line no-await-in-loop
      await pointAt(page, firstReply);
      // eslint-disable-next-line no-await-in-loop
      await expect(tooltip).toHaveText('Reply');
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({
        path: `${SHOTS}/L15-message-toolbar-hover-${scheme}.png`,
        clip: cropAround(geometry, 36),
      });
    }
  });

  // A long message folds behind a Show full message button at the end of its bottom edge, and
  // shows Show less there once unfolded. That corner is where the toolbar of the row below
  // floats, and where a long row's own toolbar ends up when the row is scrolled up under the
  // header. In both places the toolbar keeps 8 px clear of the button.
  test('keeps clear of the fold button of a long message', async ({ page }) => {
    test.setTimeout(480_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Fold ${Date.now()}`,
      topic: 'Long messages and the hover toolbar',
    });
    const longBody = (title: string) =>
      [title, ...Array.from({ length: 24 }, (_, i) => `Step ${i + 1} of the plan.`)].join('\n');
    const send = (body: string, relation?: object) =>
      sendRoomMessage(homeserver, accessToken, roomId, {
        msgtype: 'm.text',
        body,
        ...(relation ? { 'm.relates_to': relation } : {}),
      });
    const rootId = await send('Plans for the week');
    const thread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    await send(longBody('The thread plan'), thread);
    await send('A short answer in the thread.', thread);
    await send(longBody('The room plan'));
    await send('A short note in the room.');

    await signIn(page, homeserver, credentials.username, credentials.password);
    const rows = page.locator('[data-message-item]');

    /** The toolbar of `row` and the fold button of `long`, in page coordinates. */
    const boxes = async (row: Locator, long: Locator) => {
      const reply = row.getByRole('button', { name: 'Reply', exact: true });
      await expect(reply).toBeVisible();
      const pill = (await reply.locator('../..').boundingBox())!;
      const fold = (await long.getByRole('button', { name: 'Show less' }).boundingBox())!;
      return { pill, fold };
    };
    const expectApart = ({ pill, fold }: Awaited<ReturnType<typeof boxes>>, where: string) => {
      const gap = Math.max(
        fold.y - (pill.y + pill.height),
        pill.y - (fold.y + fold.height),
        fold.x - (pill.x + pill.width),
        pill.x - (fold.x + fold.width)
      );
      expect(gap, `${where}: the toolbar and Show less stay apart`).toBeGreaterThanOrEqual(7.5);
    };

    for (const [view, path, longTitle, short] of [
      [
        'thread',
        `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`,
        'The thread plan',
        'A short answer in the thread.',
      ],
      ['room', `/home/${encodeURIComponent(roomId)}`, 'The room plan', 'A short note in the room.'],
    ] as const) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        const where = `${view} at ${viewport.width} px`;
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(viewport);
        // eslint-disable-next-line no-await-in-loop
        await page.goto(path);
        const long = rows.filter({ hasText: longTitle });
        const next = rows.filter({ hasText: short });
        // eslint-disable-next-line no-await-in-loop
        await expect(next).toBeVisible({ timeout: 60_000 });
        const fold = long.getByRole('button', { name: /^(Show full message|Show less)$/ });
        // eslint-disable-next-line no-await-in-loop
        await expect(fold).toBeVisible();
        // eslint-disable-next-line no-await-in-loop
        if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
        // eslint-disable-next-line no-await-in-loop
        await expect(long.getByRole('button', { name: 'Show less' })).toBeVisible();

        // The row below the long message: its toolbar moves down, under Show less.
        // eslint-disable-next-line no-await-in-loop
        await next.scrollIntoViewIfNeeded();
        // eslint-disable-next-line no-await-in-loop
        await pointAt(page, next.getByText(short, { exact: true }));
        // eslint-disable-next-line no-await-in-loop
        const below = await boxes(next, long);
        expectApart(below, `${where}, the row below`);
        if (SHOTS) {
          const top = Math.min(below.pill.y, below.fold.y) - 24;
          const left = Math.max(0, below.pill.x - 120);
          // eslint-disable-next-line no-await-in-loop
          await page.screenshot({
            path: `${SHOTS}/L15-message-toolbar-fold-${view}-${viewport.width}.png`,
            clip: {
              x: left,
              y: top,
              width: Math.min(viewport.width, below.pill.x + below.pill.width + 24) - left,
              height: below.pill.y + below.pill.height + 40 - top,
            },
          });
        }

        // The long message scrolled up until only its end shows under the header: its toolbar
        // moves up, above Show less.
        // eslint-disable-next-line no-await-in-loop
        await long.evaluate((row) => {
          let scroller = row.parentElement;
          while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
            scroller = scroller.parentElement;
          }
          if (!scroller) return;
          const top =
            scroller.getBoundingClientRect().top +
            Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop || '0');
          scroller.scrollTop += row.getBoundingClientRect().bottom - (top + 90);
        });
        const lastStep = long.getByText('Step 24 of the plan.');
        // eslint-disable-next-line no-await-in-loop
        await expect(lastStep).toBeInViewport();
        // eslint-disable-next-line no-await-in-loop
        await pointAt(page, lastStep);
        // eslint-disable-next-line no-await-in-loop
        expectApart(await boxes(long, long), `${where}, the long row scrolled under the header`);

        // And with the long message in full view.
        // eslint-disable-next-line no-await-in-loop
        await long.evaluate((row) => row.scrollIntoView({ block: 'start' }));
        // eslint-disable-next-line no-await-in-loop
        await pointAt(page, long.getByText(longTitle));
        // eslint-disable-next-line no-await-in-loop
        expectApart(await boxes(long, long), `${where}, the long row`);
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.move(0, 0);
      }
    }
  });
});
