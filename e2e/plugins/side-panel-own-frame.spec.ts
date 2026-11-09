import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { openPanelRoom, panelLocator, widthOf } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Its side panel "Example
// card" draws its own frame (`frame: 'own'`): the room draws no title, Close, splitter or frame
// strip around the card, which is 320 px wide beside the conversation. The card's Fill fills the
// room in the conversation's place, and its Hide leaves only the card's tab at the room's edge,
// beside the conversation at the width it has with no panel. On a phone the card covers the
// conversation until Hide, and then the conversation shows beside the tab. Screenshots of each,
// in the light and the dark scheme, go to the test's output as `own-frame-<layout>-<scheme>.png`.
// Beside the conversation the card's box moves in and out as the room's panels do, through the
// client SDK's `usePanelPresence` and `animatePanel`, and at once under reduced motion.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PHONE = { width: 390, height: 844 };

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-own-frame-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

const card = (page: Page) => page.getByRole('region', { name: 'Example card', exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const menuEntry = (page: Page) =>
  page.getByRole('menuitemcheckbox', { name: 'Example card', exact: true });
/** The card's box, which moves while the card inside keeps its width. */
const cardBox = (page: Page) => page.locator('[data-example-card-box]');

/** Waits until `target` has moved to where it settles. */
const settled = (target: Locator) =>
  target.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished))
  );

const shots = async (page: Page, testInfo: TestInfo, layout: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: testInfo.outputPath(`own-frame-${layout}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

/** Chooses the card's toggle in the room menu, which is checked while the card shows. */
const toggleCard = async (page: Page, checked: boolean) => {
  await roomMoreOptions(page).click();
  await expect(menuEntry(page)).toHaveAttribute('aria-checked', String(checked));
  await menuEntry(page).click();
};

/** The room draws nothing of its own around the card. */
const expectNoRoomFrame = async (page: Page) => {
  await expect(panelLocator(page, 'plugin')).toHaveCount(0);
  await expect(button(page, 'Close Example card')).toHaveCount(0);
  await expect(button(page, 'Fill the room with Example card')).toHaveCount(0);
  await expect(button(page, 'Fold Example card to the edge')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize Example card' })).toHaveCount(0);
};

/** Serves the build, opens the panel room in a page of its own, runs `check`, and cleans up. */
const withPanelRoom = async (browser: Browser, check: (page: Page) => Promise<void>) => {
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  // A new account is asked to set up a recovery password; this spec has no use for one.
  await page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' }),
    (dialog) => dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  );
  try {
    await openPanelRoom(context, page);
    await check(page);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
};

test("the example plugin's own-frame card fills the room and hides to its tab", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    const conversation = roomHeader(page);
    // A new account shows the members beside the conversation; the card takes their place.
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await settled(cardBox(page));
    await expectNoRoomFrame(page);
    const besideWidth = await widthOf(card(page));
    expect(besideWidth).toBe(320);
    const conversationBeside = await widthOf(conversation);
    await shots(page, testInfo, 'wide-beside');

    await button(page, 'Fill example card').click();
    await expect(conversation).toHaveCount(0);
    expect(await widthOf(card(page))).toBeGreaterThan(besideWidth + conversationBeside - 40);
    await expectNoRoomFrame(page);
    await shots(page, testInfo, 'wide-filled');
    await button(page, 'Shrink example card').click();
    await expect(conversation).toBeVisible();
    await expect.poll(() => widthOf(card(page))).toBe(besideWidth);

    await button(page, 'Hide example card').click();
    const tab = button(page, 'Show example card');
    await expect(tab).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expectNoRoomFrame(page);
    const tabWidth = await widthOf(tab);
    const conversationFolded = await widthOf(conversation);
    await shots(page, testInfo, 'wide-folded');

    // With no panel at all (its toggle unfolds it first, then closes it), the conversation is as
    // wide as beside the folded card's tab and its margins.
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await toggleCard(page, true);
    await expect(card(page)).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    const conversationAlone = await widthOf(conversation);
    expect(conversationFolded).toBeGreaterThanOrEqual(conversationAlone - tabWidth - 20);
  });
});

test("on a phone the example plugin's own-frame card covers the conversation until hidden", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    await page.setViewportSize(PHONE);
    await page.reload();
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    const conversationAlone = await widthOf(roomHeader(page));
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await expectNoRoomFrame(page);
    // Over the conversation, header and all, as wide as the screen but for the card's margins.
    await expect(roomMoreOptions(page)).toBeHidden();
    expect(await widthOf(card(page))).toBeGreaterThan(PHONE.width - 30);
    await shots(page, testInfo, 'phone-beside');

    await button(page, 'Hide example card').click();
    const tab = button(page, 'Show example card');
    await expect(tab).toBeVisible();
    await expect(roomMoreOptions(page)).toBeVisible();
    expect(await widthOf(roomHeader(page))).toBeGreaterThanOrEqual(
      conversationAlone - (await widthOf(tab)) - 20
    );
    await shots(page, testInfo, 'phone-folded');

    await tab.click();
    await expect(card(page)).toBeVisible();
    await expect(roomMoreOptions(page)).toBeHidden();
  });
});

type CardMotion = { from: string; to?: string; duration: unknown; easing?: string };
/** What the page notes of the motions: the card's, held, and the members panel's timing. */
type MotionLog = { cardMotions: Animation[]; roomTiming: EffectTiming[] };
/** The last motion of the card's box and of the members panel, held at its start. */
type HeldMotions = { heldMotions: { card?: Animation; members?: Animation } };

test("the example plugin's own-frame card moves in and out as the room's panels do, at once under reduced motion", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    const conversation = roomHeader(page);
    const members = panelLocator(page, 'members');
    const box = cardBox(page);
    // Each motion of the card's box is held at its start for the test to step through; the room's
    // own panels move as they do, and the members panel's timing is noted.
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      const state = window as unknown as MotionLog;
      state.cardMotions = [];
      state.roomTiming = [];
      Element.prototype.animate = function hold(this: Element, ...args) {
        const animation = animate.apply(this, args);
        if (this.matches('[data-example-card-box]')) {
          animation.pause();
          state.cardMotions.push(animation);
        } else if (this.matches('[data-testid="resizable-members-panel"]')) {
          state.roomTiming.push(animation.effect!.getTiming());
        }
        return animation;
      };
    });
    /** The card's motions so far: where each starts and ends, and their time and curve. */
    const motions = () =>
      page.evaluate(() =>
        (window as unknown as MotionLog).cardMotions.map((animation) => {
          const effect = animation.effect as KeyframeEffect;
          const [first, last] = effect.getKeyframes();
          const { duration, easing } = effect.getTiming();
          return { from: first!.width, to: last?.width, duration, easing } as CardMotion;
        })
      );
    /** Puts the card's last motion at `time` (in ms), or plays it to its end. */
    const step = (time: number | 'end') =>
      page.evaluate((at) => {
        const animation = (window as unknown as MotionLog).cardMotions.at(-1)!;
        if (at === 'end') animation.play();
        else animation.currentTime = at;
      }, time);
    const toEnd = async () => {
      await step('end');
      await settled(box);
    };

    // The members, which a new account shows, move out and in as the room's panels do.
    await conversation.getByRole('button', { name: 'Hide Members', exact: true }).click();
    await expect(members).toHaveCount(0);
    const conversationAlone = await widthOf(conversation);
    await conversation.getByRole('button', { name: 'Show Members', exact: true }).click();
    await settled(members);
    const membersWidth = await widthOf(members);
    const [roomTiming] = await page.evaluate(() => (window as unknown as MotionLog).roomTiming);

    // Opened in the members' place, the card moves from their width to its own, in the time and on
    // the curve of the room's panels, and the conversation gives way.
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    const [taking] = await motions();
    expect(taking).toMatchObject({ duration: roomTiming!.duration, easing: roomTiming!.easing });
    expect(Number.parseFloat(taking!.from)).toBeCloseTo(membersWidth, -1);
    await step(110);
    const halfway = await widthOf(box);
    expect(halfway).toBeGreaterThan(membersWidth + 5);
    expect(halfway).toBeLessThan(336);
    expect(await widthOf(conversation)).toBeCloseTo(conversationAlone - halfway, -1);
    await toEnd();
    expect(await widthOf(box)).toBe(336);
    expect(await widthOf(conversation)).toBeCloseTo(conversationAlone - 336, -1);

    // Closed, it stays while it moves out.
    await toggleCard(page, true);
    expect((await motions()).at(-1)).toMatchObject({ from: '336px', to: '0px' });
    await step(110);
    await expect(card(page)).toBeVisible();
    const leaving = await widthOf(box);
    expect(leaving).toBeGreaterThan(0);
    expect(leaving).toBeLessThan(336);

    // Turned around as it moves out, it moves on from where it is and settles at its width.
    await page.evaluate(() => {
      const animation = (window as unknown as MotionLog).cardMotions.at(-1)!;
      animation.playbackRate = 0.001;
      animation.play();
    });
    await toggleCard(page, false);
    expect(Number.parseFloat((await motions()).at(-1)!.from)).toBeCloseTo(leaving, -1);
    await toEnd();
    expect(await widthOf(box)).toBe(336);

    // Closed, it goes once it has moved out; opened again, it moves in from nothing.
    await toggleCard(page, true);
    await step('end');
    await expect(card(page)).toHaveCount(0);
    expect(await widthOf(conversation)).toBeCloseTo(conversationAlone, -1);
    await toggleCard(page, false);
    expect((await motions()).at(-1)).toMatchObject({ from: '0px', to: undefined });
    await toEnd();
    await toggleCard(page, true);
    await step('end');
    await expect(card(page)).toHaveCount(0);

    // Under reduced motion it opens and closes at once.
    const moved = (await motions()).length;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    expect(await widthOf(box)).toBe(336);
    await toggleCard(page, true);
    await expect(card(page)).toHaveCount(0);
    expect(await motions()).toHaveLength(moved);
  });
});

test("a panel swapped out as it moves out leaves the next panel's exit alone, the card's and the members'", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    const conversation = roomHeader(page);
    const members = panelLocator(page, 'members');
    // Each motion of the card's box and of the members panel is held at its start, so the test
    // decides when each ends, also after its panel has gone.
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      const held: HeldMotions['heldMotions'] = {};
      (window as unknown as HeldMotions).heldMotions = held;
      Element.prototype.animate = function hold(this: Element, ...args) {
        const animation = animate.apply(this, args);
        const which = this.matches('[data-example-card-box]')
          ? 'card'
          : this.matches('[data-testid="resizable-members-panel"]') && 'members';
        if (which) {
          animation.pause();
          held[which] = animation;
        }
        return animation;
      };
    });
    /** Ends the last motion of the card's box or of the members panel, and lets the room render. */
    const finish = (which: 'card' | 'members') =>
      page.evaluate(async (name) => {
        (window as unknown as HeldMotions).heldMotions[name]!.finish();
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        await frame();
        await frame();
      }, which);
    const showMembers = () =>
      conversation.getByRole('button', { name: 'Show Members', exact: true }).click();
    const hideMembers = () =>
      conversation.getByRole('button', { name: 'Hide Members', exact: true }).click();

    // The members, which a new account shows, start to move out; the card takes their place and
    // starts to move out too. The members' motion ends only then, and ends nothing of the card's.
    await expect(members).toBeVisible();
    await hideMembers();
    await toggleCard(page, false);
    await expect(members).toHaveCount(0);
    await finish('card');
    await toggleCard(page, true);
    await finish('members');
    expect(await card(page).count()).toBe(1);
    await finish('card');
    await expect(card(page)).toHaveCount(0);

    // The other way round: the card moves out, the members take its place and move out, and the
    // card's motion, which ends only then, ends nothing of theirs.
    await toggleCard(page, false);
    await finish('card');
    await toggleCard(page, true);
    await showMembers();
    await expect(card(page)).toHaveCount(0);
    await finish('members');
    await hideMembers();
    await finish('card');
    expect(await members.count()).toBe(1);
    await finish('members');
    await expect(members).toHaveCount(0);
  });
});
