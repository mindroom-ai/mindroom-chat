import { mkdirSync, writeFileSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { putPhoneDrawerAway } from '../helpers/phoneDrawer';

// Scratch harness (not for main): the new version notice in each place it can take, at a phone
// and a desktop size, in Chromium and WebKit. Saves a page shot, a card shot and the boxes of the
// card's parts into NOTICE_SHOTS, so two commits can be compared.
const DIR = process.env.NOTICE_SHOTS ?? 'test-results/notice-shots';
const PASSWORD = 'notice-shots-password';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.skip(!previewBuildDir(), 'Needs the production build of scripts/e2e-slot.sh --preview');
});

const card = (page: Page) => page.locator('[data-new-version-card]');

// The sign-in page draws a random stipple behind the card, which shows through its glass: the
// same seed on every run draws the same one.
const seeded = () => {
  let state = 1;
  Math.random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
};

const record = async (page: Page, name: string, placement: 'list' | 'page') => {
  await expect(card(page)).toHaveAttribute('data-new-version-card', placement, { timeout: 30_000 });
  await card(page).evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
  );
  await page.waitForTimeout(600);
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}-page.png`, animations: 'disabled' });
  await card(page).screenshot({ path: `${DIR}/${name}-card.png`, animations: 'disabled' });
  const boxes = await card(page).evaluate((element) => {
    const box = (part: Element | null | undefined) => {
      if (!part) return null;
      const { x, y, width, height } = part.getBoundingClientRect();
      return [x, y, width, height].map((value) => Math.round(value * 100) / 100);
    };
    const buttons = [...element.querySelectorAll('button')];
    const text = [...element.querySelectorAll('div')].find(
      (div) => div.children.length === 0 && div.textContent?.includes('new version')
    );
    const mark = element.querySelector('span[aria-hidden]');
    const style = getComputedStyle(element);
    const markStyle = mark ? getComputedStyle(mark) : undefined;
    return {
      placement: element.getAttribute('data-new-version-card'),
      slot: box(element.parentElement),
      card: box(element),
      mark: box(mark),
      icon: box(mark?.querySelector('svg')),
      text: box(text),
      reload: box(buttons.find((button) => button.textContent?.includes('Reload'))),
      dismiss: box(element.querySelector('button[aria-label]')),
      cardStyle: [style.padding, style.borderRadius, style.backgroundColor, style.boxShadow],
      markStyle: markStyle && [
        markStyle.borderRadius,
        markStyle.backgroundColor,
        markStyle.color,
        markStyle.width,
        markStyle.height,
      ],
      hit: (() => {
        const { x, y, width, height } = element.getBoundingClientRect();
        const hit = document.elementFromPoint(x + width / 2, y + height / 2);
        return hit !== null && element.contains(hit);
      })(),
    };
  });
  writeFileSync(`${DIR}/${name}.json`, `${JSON.stringify(boxes, null, 1)}\n`);
};

/**
 * The sync status pill with the connection cut: its own shot, the card above it when both share
 * the page's place, its boxes and styles, and what a click at its centre reaches.
 */
const recordWithPill = async (page: Page, name: string, stacked: boolean) => {
  await page.context().setOffline(true);
  const pill = page.getByTestId('client-sync-status');
  await expect(pill).toBeVisible({ timeout: 60_000 });
  await pill.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
  );
  await page.waitForTimeout(600);
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}-page.png`, animations: 'disabled' });
  await pill.screenshot({ path: `${DIR}/${name}-pill.png`, animations: 'disabled' });
  const cardBox = await card(page).boundingBox();
  const pillBox = await pill.boundingBox();
  if (!cardBox || !pillBox) throw new Error('no card or pill');
  if (stacked) {
    const x = Math.max(0, Math.min(cardBox.x, pillBox.x) - 8);
    const y = Math.max(0, Math.min(cardBox.y, pillBox.y) - 8);
    const right = Math.max(cardBox.x + cardBox.width, pillBox.x + pillBox.width) + 8;
    const bottom = Math.max(cardBox.y + cardBox.height, pillBox.y + pillBox.height) + 8;
    await page.screenshot({
      path: `${DIR}/${name}-stack.png`,
      animations: 'disabled',
      clip: { x, y, width: right - x, height: bottom - y },
    });
  }
  const details = await pill.evaluate((element) => {
    const box = (part: Element | null) => {
      if (!part) return null;
      const { x, y, width, height } = part.getBoundingClientRect();
      return [x, y, width, height].map((value) => Math.round(value * 100) / 100);
    };
    const style = getComputedStyle(element);
    const { x, y, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return {
      slot: box(element.parentElement),
      pill: box(element),
      icon: box(element.firstElementChild),
      text: box(element.lastElementChild),
      words: element.textContent,
      style: [
        style.display,
        style.order,
        style.padding,
        style.minHeight,
        style.maxWidth,
        style.borderRadius,
        style.gap,
        style.alignItems,
        style.pointerEvents,
        style.backgroundColor,
        style.color,
      ],
      clickReachesPill: hit !== null && element.contains(hit),
      clickReaches: hit ? `${hit.tagName}${hit.id ? `#${hit.id}` : ''}` : null,
    };
  });
  const round = (value: { x: number; y: number; width: number; height: number }) =>
    [value.x, value.y, value.width, value.height].map((part) => Math.round(part * 100) / 100);
  writeFileSync(
    `${DIR}/${name}.json`,
    `${JSON.stringify({ card: round(cardBox), ...details }, null, 1)}\n`
  );
  await page.context().setOffline(false);
  await expect(pill).toHaveCount(0, { timeout: 60_000 });
};

const signIn = async (page: Page, username: string) => {
  // A fresh homeserver per job; an account left from an earlier run signs in as it is.
  await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await putPhoneDrawerAway(page);
};

const allPlaces = async (
  engine: string,
  open: (options: BrowserContextOptions) => Promise<Page>,
  phone: BrowserContextOptions
) => {
  const server = await serveBuild(previewBuildDir()!, { publishedVersion: () => 'notice-shots' });
  try {
    const desktop = { baseURL: server.origin, viewport: DESKTOP };
    const phoneOptions = { baseURL: server.origin, viewport: PHONE, ...phone };

    let page = await open(desktop);
    await page.goto('/');
    await record(page, `${engine}-desktop-signedout`, 'page');
    await page.context().close();

    page = await open(desktop);
    await signIn(page, `noticeshots_${engine}_desktop`);
    await record(page, `${engine}-desktop-list`, 'list');
    await recordWithPill(page, `${engine}-desktop-list-pill`, false);
    await page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('button', { name: 'Collapse navigation panel' })
      .click();
    await record(page, `${engine}-desktop-page`, 'page');
    await recordWithPill(page, `${engine}-desktop-page-pill`, true);
    await page.context().close();

    page = await open(phoneOptions);
    await page.goto('/');
    await record(page, `${engine}-phone-signedout`, 'page');
    await page.context().close();

    // With more contrast the card is opaque, so its shot leaves out the page behind it.
    for (const [size, options] of [
      ['desktop', desktop],
      ['phone', phoneOptions],
    ] as const) {
      page = await open({ ...options, contrast: 'more' });
      await page.goto('/');
      await record(page, `${engine}-${size}-signedout-opaque`, 'page');
      await page.context().close();
    }

    page = await open(phoneOptions);
    await signIn(page, `noticeshots_${engine}_phone`);
    await record(page, `${engine}-phone-page`, 'page');
    await recordWithPill(page, `${engine}-phone-page-pill`, true);
    await page.context().close();
  } finally {
    await server.close();
  }
};

test('notice places (Chromium)', async ({ browser }) => {
  test.setTimeout(240_000);
  await allPlaces(
    'chromium',
    async (options) => {
      const context = await browser.newContext(options);
      await context.addInitScript(seeded);
      return context.newPage();
    },
    { hasTouch: true, isMobile: true }
  );
});

test('notice places (WebKit)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const webkit: Browser = await launchWebKit();
  try {
    await allPlaces(
      'webkit',
      async (options) => {
        const context = await webkit.newContext(options);
        await context.addInitScript(seeded);
        return context.newPage();
      },
      {
        hasTouch: true,
      }
    );
  } finally {
    await webkit.close();
  }
});
