import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateSpace, matrixFetch, setAccountData } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The rail keeps Home, Direct Messages, Activity, Threads and Canvases in place while only the
// spaces scroll, when the part between that group and the foot group shows at least four space
// buttons; with less room the whole top part scrolls as one column, and it pins again from five.
// Checked with 26 spaces, classic scrollbars, 600, 800 and 1000 px tall windows, and every
// optional rail button on or off. Set RAIL_PIN_SHOTS=<directory> to also save the L25 screenshots.
const PASSWORD = 'rail-pin-spec-password';
const SHOTS = process.env.RAIL_PIN_SHOTS;
const SPACE_COUNT = 26;
const HEIGHTS = [600, 800, 1000];
const HOVER_INDICATOR = 18;
/** A hovered selected entry's indicator: taller than its 24 px at rest. */
const SELECTED_HOVER_INDICATOR = 32;

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them, and a
// scrollbar would take width from the rail.
test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

type Account = { username: string; userId: string; accessToken: string; spaces: string[] };

/** Every optional rail button on, or every one off. */
type ButtonSet = 'on' | 'off';

const OPTIONAL_BUTTONS = {
  Threads: 'showThreadsInSidebar',
  Canvases: 'showCanvasesInSidebar',
  'Explore Community': 'showExploreInSidebar',
  'Create Space': 'showCreateSpaceInSidebar',
  'Open command palette': 'showSearchInSidebar',
  MindRoom: 'showLocalMindroomInSidebar',
} as const;

/** A new account with SPACE_COUNT spaces and the rail's optional buttons on or off. */
const seedAccount = async (prefix: string, buttons: ButtonSet): Promise<Account> => {
  // A random suffix: the specs of one run share the homeserver.
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const registered = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const { user_id: userId, access_token: accessToken } = registered;
  const spaces: string[] = [];
  for (let start = 0; start < SPACE_COUNT; start += 6) {
    const batch = Array.from({ length: Math.min(6, SPACE_COUNT - start) }, (_, offset) =>
      createPrivateSpace(HOMESERVER, accessToken, {
        name: `Pin Space ${String(start + offset + 1).padStart(2, '0')}`,
        topic: '',
      })
    );
    spaces.push(...(await Promise.all(batch)));
  }
  // Saved in this order, so the rail lists them as created.
  await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.spaces', { sidebar: spaces });
  const on = buttons === 'on';
  await setAccountData(
    HOMESERVER,
    accessToken,
    userId,
    'io.mindroom.settings',
    Object.fromEntries(Object.values(OPTIONAL_BUTTONS).map((setting) => [setting, on]))
  );
  if (on) {
    // The Canvases button shows once there is a canvas; a pinned one is enough.
    await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.pinned_canvases', {
      canvases: [{ room_id: spaces[0], event_id: '$rail-pin-canvas' }],
    });
  }
  return { username, userId, accessToken, spaces };
};

/** The deployment offers canvases and Local MindRoom; the slot has no provisioning service. */
const routeDeployment = async (page: Page) => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        // Local MindRoom pairs only accounts on the provisioning service's own homeserver.
        sidebar: { ...config.sidebar, mindRoomProvisioningUrl: HOMESERVER },
        mindroom: { ...config.mindroom, canvas: { enabled: true } },
      },
    });
  });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const spaceButton = (page: Page, spaceId: string) =>
  rail(page).locator(`button[data-id="${spaceId}"]`);
const homeButton = (page: Page) => rail(page).getByRole('button', { name: 'Home', exact: true });
/** Home's entry's top: hovering grows the raised button itself a little. */
const homeTop = async (page: Page) =>
  (await homeButton(page).locator('xpath=..').boundingBox())?.y ?? Number.NaN;

/** Waits until the rail shows every space and exactly the optional buttons of the set. */
const expectRailReady = async (page: Page, account: Account, buttons: ButtonSet) => {
  await expect(spaceButton(page, account.spaces.at(-1) ?? '')).toBeAttached({ timeout: 60_000 });
  for (const name of Object.keys(OPTIONAL_BUTTONS)) {
    await expect(rail(page).getByRole('button', { name, exact: true })).toHaveCount(
      buttons === 'on' ? 1 : 0,
      { timeout: 30_000 }
    );
  }
  // The pin follows a resize observer: give it a frame or two after the last change.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
};

const signIn = async (page: Page, account: Account, buttons: ButtonSet, height: number) => {
  await routeDeployment(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });
  await page.setViewportSize({ width: 1280, height });
  await expectRailReady(page, account, buttons);
};

/** Opens the app afresh in a window `height` px tall, so no earlier size decides the pin. */
const reopenAt = async (page: Page, account: Account, buttons: ButtonSet, height: number) => {
  await page.setViewportSize({ width: 1280, height });
  await page.reload();
  await expect(rail(page)).toBeVisible({ timeout: 60_000 });
  // Until the first sync, a catching-up bar above the shell makes the rail shorter.
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expectRailReady(page, account, buttons);
};

type RailLayout = {
  pinned: boolean;
  /** Space buttons wholly between the top group and the foot group with the spaces at their start. */
  shownAtStart: number;
  /** The scroller's offset and range. */
  scrollTop: number;
  maxScroll: number;
  /** Width a scrollbar takes from the scroller. */
  scrollbar: number;
  moreAbove: boolean;
  moreBelow: boolean;
  /** Whether Home sits inside the box that scrolls. */
  homeScrolls: boolean;
  /** The band between the top group and the foot group, and the scroller's visible band. */
  band: { top: number; bottom: number };
  view: { top: number; bottom: number };
  /** Heights the pin rule is measured with: the part above the foot, and the top group. */
  areaHeight: number;
  topHeight: number;
};

const readLayout = (page: Page): Promise<RailLayout> =>
  rail(page).evaluate((nav) => {
    const area = nav.querySelector<HTMLElement>('[data-pinned], [data-rail-scroller]');
    const scroller = nav.querySelector<HTMLElement>('[data-rail-scroller]');
    const top = area?.firstElementChild;
    const home = nav.querySelector('button[aria-label="Home"]') ?? nav.querySelector('button');
    if (!area || !scroller || !top || !home) throw new Error('the rail has no scrolling part');
    const areaBox = area.getBoundingClientRect();
    const topBox = top.getBoundingClientRect();
    const band = { top: topBox.bottom, bottom: areaBox.bottom };
    const viewBox = scroller.getBoundingClientRect();
    // At the start of the spaces, both layouts place them alike: count from the scroller's start.
    const offset = scroller.scrollTop;
    const spaces = [...nav.querySelectorAll('[role="group"] button[data-id]')].map((button) =>
      (button.parentElement ?? button).getBoundingClientRect()
    );
    const shownAtStart = spaces.filter(
      (box) => box.top + offset >= band.top - 0.5 && box.bottom + offset <= band.bottom + 0.5
    ).length;
    return {
      pinned: area.hasAttribute('data-pinned'),
      shownAtStart,
      scrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight,
      scrollbar: scroller.offsetWidth - scroller.clientWidth,
      moreAbove: area.hasAttribute('data-more-above'),
      moreBelow: area.hasAttribute('data-more-below'),
      homeScrolls: scroller.contains(home),
      band,
      view: { top: viewBox.top, bottom: viewBox.bottom },
      areaHeight: area.clientHeight,
      topHeight: top.getBoundingClientRect().height,
    };
  });

/** Scrolls the rail's scroller to `to` (px, or 'end') with the wheel over the rail. */
const scrollRail = async (page: Page, to: number | 'end') => {
  const target = await rail(page).evaluate((nav, wanted) => {
    const scroller = nav.querySelector<HTMLElement>('[data-rail-scroller]');
    if (!scroller) return 0;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return wanted === 'end' ? max : Math.min(max, wanted);
  }, to);
  const box = await rail(page).boundingBox();
  const layout = await readLayout(page);
  await page.mouse.move((box?.x ?? 0) + 33, (layout.view.top + layout.view.bottom) / 2);
  for (let step = 0; step < 40; step += 1) {
    const { scrollTop } = await readLayout(page);
    if (Math.abs(scrollTop - target) < 1) break;
    await page.mouse.wheel(0, Math.max(-400, Math.min(400, target - scrollTop)));
    await page.waitForTimeout(60);
  }
  await expect
    .poll(async () => Math.abs((await readLayout(page)).scrollTop - target))
    .toBeLessThan(1);
};

const settle = (page: Page) => page.waitForTimeout(400);
const pointerAway = async (page: Page) => {
  await page.mouse.move(700, 300);
  await settle(page);
};

/**
 * The hovered entry's indicator as it reaches the screen at the rail's leading edge: whether the
 * pointer finds the entry there, and how many pixel rows of the edge stand out from the rail.
 */
const drawnIndicator = async (page: Page, button: Locator) => {
  const entry = button.locator('xpath=..');
  const { x, top, uncovered } = await entry.evaluate((element) => {
    const nav = element.closest('nav')?.getBoundingClientRect();
    const rtl = getComputedStyle(element).direction === 'rtl';
    const edge = rtl ? (nav?.right ?? 0) - 4 : nav?.left ?? 0;
    const box = element.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    return {
      x: edge,
      top: middle - 20,
      uncovered: [-6, 0, 6].every(
        (offset) => document.elementFromPoint(edge + 2, middle + offset) === element
      ),
    };
  });
  const png = await page.screenshot({ clip: { x, y: top, width: 4, height: 40 }, scale: 'css' });
  const rows = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const luminance = (y: number) => {
      const at = (y * image.width + 2) * 4;
      return (
        0.299 * (pixels[at] ?? 0) + 0.587 * (pixels[at + 1] ?? 0) + 0.114 * (pixels[at + 2] ?? 0)
      );
    };
    const railTone = luminance(2);
    let drawn = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (Math.abs(luminance(y) - railTone) > 40) drawn += 1;
    }
    return drawn;
  }, png.toString('base64'));
  return { uncovered, rows };
};

/**
 * Hovers the button and expects its whole hover indicator on screen at the rail's edge, the
 * taller one for the selected entry.
 */
const expectIndicator = async (page: Page, name: string, button: Locator) => {
  await pointerAway(page);
  await button.hover();
  await settle(page);
  const selected = (await button.locator('xpath=..').getAttribute('data-active')) !== null;
  const height = selected ? SELECTED_HOVER_INDICATOR : HOVER_INDICATOR;
  const drawn = await drawnIndicator(page, button);
  expect.soft(drawn.uncovered, `${name}: nothing covers the indicator`).toBe(true);
  expect
    .soft(Math.abs(drawn.rows - height), `${name}: ${drawn.rows} of ${height} px drawn`)
    .toBeLessThanOrEqual(2);
};

/** The button lies wholly inside the scroller's visible band. */
const expectInView = async (page: Page, name: string, button: Locator) => {
  const { view } = await readLayout(page);
  const box = await button.locator('xpath=..').boundingBox();
  expect(box, name).not.toBeNull();
  expect(box?.y ?? 0, `${name} top`).toBeGreaterThanOrEqual(view.top - 0.5);
  expect((box?.y ?? 0) + (box?.height ?? 0), `${name} bottom`).toBeLessThanOrEqual(
    view.bottom + 0.5
  );
};

/** Opens a space from the command palette by its name. */
const openFromPalette = async (page: Page, name: string) => {
  await pointerAway(page);
  await pressPaletteShortcut(page);
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await expect(palette.getByRole('combobox')).toBeFocused();
  await palette.getByRole('combobox').fill(name);
  await expect(palette.locator('[role="option"][aria-selected="true"]')).toContainText(name);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
};

for (const buttons of ['on', 'off'] as const) {
  test(`with every optional rail button ${buttons}, the top group pins only where four spaces fit`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const account = await seedAccount(`rail_pin_${buttons}`, buttons);
    await signIn(page, account, buttons, HEIGHTS[0] ?? 600);

    // The first pinned and unpinned layouts with every button on make the L25 screenshots.
    const shot = { pinned: false, unpinned: false };
    for (const height of HEIGHTS) {
      const label = `${buttons}, ${height} px`;
      await reopenAt(page, account, buttons, height);
      const start = await readLayout(page);
      testInfo.annotations.push({
        type: 'rail-pin',
        description: `buttons ${buttons}, window ${height} px: ${
          start.shownAtStart
        } spaces fit below the top group, ${start.pinned ? 'pinned' : 'unpinned'}`,
      });

      // The measured fit per case, for the record.
      console.log(
        `rail-pin: buttons ${buttons}, ${height} px: ${start.shownAtStart} spaces fit, ${
          start.pinned ? 'pinned' : 'unpinned'
        }`
      );
      // Pinned from five, unpinned below four. With exactly four the rail keeps the layout it
      // had: pinned when it opened at this size, unpinned when the catching-up bar made it
      // shorter at first.
      if (start.shownAtStart !== 4) {
        expect(start.pinned, `${label}: pinned with ${start.shownAtStart} fitting`).toBe(
          start.shownAtStart >= 5
        );
      }
      expect(start.homeScrolls, `${label}: Home scrolls`).toBe(!start.pinned);
      expect(start.scrollbar, `${label}: no scrollbar`).toBe(0);
      expect(start.maxScroll, `${label}: the spaces overflow`).toBeGreaterThan(100);
      // At the start, a fade only toward the end.
      expect([start.moreAbove, start.moreBelow], `${label}: fades at the start`).toEqual([
        false,
        true,
      ]);

      // The first space and Home show their whole indicators at the start of the list.
      await expectIndicator(
        page,
        `${label}, the first space`,
        spaceButton(page, account.spaces[0] ?? '')
      );
      await expectIndicator(page, `${label}, Home`, homeButton(page));

      // Scrolling the spaces: pinned, Home stays put; unpinned, it scrolls away with them.
      const homeBefore = await homeTop(page);
      await scrollRail(page, 150);
      const middle = await readLayout(page);
      expect([middle.moreAbove, middle.moreBelow], `${label}: fades midway`).toEqual([true, true]);
      const homeAfter = await homeTop(page);
      if (start.pinned) {
        expect(homeAfter, `${label}: Home stays put`).toBeCloseTo(homeBefore, 0);
      } else {
        expect(homeBefore - homeAfter, `${label}: Home scrolls away`).toBeCloseTo(150, 0);
      }
      if (start.pinned && SHOTS && buttons === 'on' && !shot.pinned) {
        shot.pinned = true;
        await pointerAway(page);
        const box = await rail(page).boundingBox();
        await page.screenshot({
          path: `${SHOTS}/L25-rail-fade.png`,
          clip: { x: 0, y: middle.view.top - 90, width: 160, height: 200 },
        });
        await page.screenshot({
          path: `${SHOTS}/L25-rail-pinned.png`,
          clip: { x: 0, y: 0, width: 300, height: box?.height ?? height },
        });
      }

      // At the end: a fade only toward the start, and the last entry shows its whole indicator.
      await scrollRail(page, 'end');
      const end = await readLayout(page);
      expect([end.moreAbove, end.moreBelow], `${label}: fades at the end`).toEqual([true, false]);
      const last =
        buttons === 'on'
          ? rail(page).getByRole('button', { name: 'Create Space', exact: true })
          : spaceButton(page, account.spaces.at(-1) ?? '');
      await expectIndicator(page, `${label}, the last entry`, last);
      if (!start.pinned && SHOTS && buttons === 'on' && !shot.unpinned) {
        shot.unpinned = true;
        await pointerAway(page);
        await page.screenshot({
          path: `${SHOTS}/L25-rail-unpinned.png`,
          clip: { x: 0, y: 0, width: 300, height },
        });
      }

      // Opening a space scrolled out of view, from the command palette, brings it into view.
      await scrollRail(page, 0);
      const deep = account.spaces[SPACE_COUNT - 3] ?? '';
      await openFromPalette(page, `Pin Space ${String(SPACE_COUNT - 2).padStart(2, '0')}`);
      await expect(spaceButton(page, deep).locator('xpath=..')).toHaveAttribute(
        'data-active',
        'true'
      );
      await expect
        .poll(async () => (await readLayout(page)).scrollTop, { message: `${label}: scrolled` })
        .toBeGreaterThan(0);
      await expectInView(page, `${label}, the opened space`, spaceButton(page, deep));
      await expectIndicator(page, `${label}, the opened space`, spaceButton(page, deep));
      await homeButton(page).click();
    }
  });
}

test('resizing switches the pin once each way and keeps the selected space in place', async ({
  page,
}) => {
  // Over 200 window sizes: a loaded machine needs the time.
  test.setTimeout(600_000);
  const account = await seedAccount('rail_pin_resize', 'on');
  await signIn(page, account, 'on', 900);
  const selectedId = account.spaces[9] ?? '';
  const selected = spaceButton(page, selectedId);
  await selected.click();
  await expect(selected.locator('xpath=..')).toHaveAttribute('data-active', 'true');
  await pointerAway(page);
  // The selected space a little below the top group.
  await scrollRail(page, 330);

  const selectedY = async () => (await selected.locator('xpath=..').boundingBox())?.y ?? NaN;
  const steps: Array<{ height: number; pinned: boolean; fit: number }> = [];
  const pitch = await rail(page).evaluate((nav) => {
    const [a, b] = [...nav.querySelectorAll('[role="group"] button[data-id]')].map(
      (button) => (button.parentElement ?? button).getBoundingClientRect().top
    );
    return (b ?? 0) - (a ?? 0);
  });
  // Space buttons that fit below the top group, counted at the start of the list.
  const fitAt = (layout: RailLayout, inset: number) =>
    Math.floor((layout.areaHeight - layout.topHeight - inset + (pitch - 42)) / pitch);
  const first = await readLayout(page);
  const inset = await rail(page).evaluate((nav) => {
    const area = nav.querySelector<HTMLElement>('[data-pinned], [data-rail-scroller]');
    const content = area?.lastElementChild?.firstElementChild;
    const button = content?.querySelector('button');
    if (!content || !button?.parentElement) return 0;
    return button.parentElement.getBoundingClientRect().top - content.getBoundingClientRect().top;
  });
  expect(first.pinned).toBe(true);

  const sizes = [
    ...Array.from({ length: 110 }, (_, step) => 900 - step * 4),
    ...Array.from({ length: 110 }, (_, step) => 464 + step * 4),
  ];
  let previousY = await selectedY();
  let previousPinned = first.pinned;
  for (const height of sizes) {
    await page.setViewportSize({ width: 1280, height });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );
    const layout = await readLayout(page);
    const y = await selectedY();
    steps.push({ height, pinned: layout.pinned, fit: fitAt(layout, inset) });
    if (layout.pinned !== previousPinned) {
      // A switch keeps the selected space where it was, unless the top group now covers it.
      const covered = layout.pinned && previousY < layout.view.top;
      if (!covered) expect(y, `the selected space at ${height} px`).toBeCloseTo(previousY, 0);
      await expectInView(page, `the selected space after switching at ${height} px`, selected);
    } else if (height < (steps.at(-2)?.height ?? Infinity)) {
      // Shrinking the window moves nothing in the rail's scrolling part.
      expect(Math.abs(y - previousY), `the selected space at ${height} px`).toBeLessThan(1);
    }
    previousY = y;
    previousPinned = layout.pinned;
  }

  const switches = steps.filter(
    (step, index) => index > 0 && step.pinned !== steps[index - 1]?.pinned
  );
  expect(switches.map((step) => step.pinned)).toEqual([false, true]);
  const [unpin, pin] = switches;
  // Unpinned below four, pinned again from five, and between them it stays as it was.
  expect(unpin?.fit).toBe(3);
  expect(pin?.fit).toBe(5);
  for (const step of steps) {
    if (step.fit < 4) expect(step.pinned, `${step.height} px`).toBe(false);
    if (step.fit >= 5) expect(step.pinned, `${step.height} px`).toBe(true);
  }
  expect(steps.some((step) => step.fit === 4 && step.pinned)).toBe(true);
  expect(steps.some((step) => step.fit === 4 && !step.pinned)).toBe(true);
});

test('pinned: keyboard order, dragging with auto-scroll, a collapsed panel and right to left', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const account = await seedAccount('rail_pin_more', 'on');
  await signIn(page, account, 'on', 900);
  expect((await readLayout(page)).pinned).toBe(true);

  // Keyboard focus: the top group, the spaces in order, Explore and Create Space, the foot.
  await homeButton(page).focus();
  const order: string[] = [];
  for (let step = 0; step < SPACE_COUNT + 9; step += 1) {
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        return (
          element?.getAttribute('data-id') ??
          element?.getAttribute('aria-label') ??
          element?.querySelector('img')?.getAttribute('alt') ??
          ''
        );
      })
    );
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual([
    'Home',
    'Direct Messages',
    'Activity',
    'Threads',
    'Canvases',
    ...account.spaces,
    'Explore Community',
    'Create Space',
    'Open command palette',
    'MindRoom',
  ]);
  // Tabbing scrolled the spaces along; Home never moved.
  expect((await readLayout(page)).scrollTop).toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  // Dragging the first space to the bottom edge scrolls the spaces, then drops it lower down.
  await scrollRail(page, 0);
  const homeY = await homeTop(page);
  const dragged = account.spaces[0] ?? '';
  const from = await spaceButton(page, dragged).boundingBox();
  const { view } = await readLayout(page);
  const x = (from?.x ?? 0) + (from?.width ?? 0) / 2;
  await page.mouse.move(x, (from?.y ?? 0) + (from?.height ?? 0) / 2);
  await page.mouse.down();
  await page.mouse.move(x, (from?.y ?? 0) + 30, { steps: 4 });
  await page.mouse.move(x, view.bottom - 6, { steps: 12 });
  await expect
    .poll(async () => (await readLayout(page)).scrollTop, { timeout: 10_000 })
    .toBeGreaterThan(200);
  expect(await homeTop(page), 'Home stays put while dragging').toBeCloseTo(homeY, 0);
  // Back in the middle the scrolling stops. Drop in the gap above a space there (not on the
  // dragged space, which follows the pointer), so the two do not become a folder.
  await page.mouse.move(x, (view.top + view.bottom) / 2, { steps: 6 });
  await settle(page);
  const target = await rail(page).evaluate(
    (nav, { middle, skip }) => {
      const entries = [...nav.querySelectorAll('[role="group"] button[data-id]')]
        .filter((button) => button.getAttribute('data-id') !== skip)
        .map((button) => ({
          id: button.getAttribute('data-id') ?? '',
          box: (button.parentElement ?? button).getBoundingClientRect(),
        }));
      const near = entries.find((entry) => entry.box.top > middle) ?? entries[0];
      return { id: near?.id ?? '', y: (near?.box.top ?? 0) - 6 };
    },
    { middle: (view.top + view.bottom) / 2, skip: dragged }
  );
  await page.mouse.move(x, target.y, { steps: 6 });
  await settle(page);
  await page.mouse.up();
  await expect
    .poll(() =>
      rail(page)
        .getByRole('group', { name: 'Spaces' })
        .locator('[data-id]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-id')))
    )
    .not.toEqual(account.spaces);
  const moved = await rail(page)
    .getByRole('group', { name: 'Spaces' })
    .locator('[data-id]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-id')));
  expect(moved.indexOf(dragged), 'the dragged space landed lower down').toBeGreaterThan(5);
  expect(moved.indexOf(dragged), 'just above the space under the pointer').toBe(
    moved.indexOf(target.id) - 1
  );

  // Collapsing the page navigation leaves the rail as it is.
  await scrollRail(page, 0);
  await rail(page).getByRole('button', { name: 'Collapse navigation panel' }).click();
  await settle(page);
  const collapsed = await readLayout(page);
  expect(collapsed.pinned).toBe(true);
  expect(await homeTop(page)).toBeCloseTo(homeY, 0);
  await rail(page).getByRole('button', { name: 'Expand navigation panel' }).click();

  // Right to left: still pinned, no scrollbar, and indicators at the right edge at both ends.
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  await settle(page);
  const rtl = await readLayout(page);
  expect(rtl.pinned).toBe(true);
  expect(rtl.scrollbar).toBe(0);
  await expectIndicator(page, 'right to left, the first space', spaceButton(page, moved[0] ?? ''));
  await scrollRail(page, 'end');
  await expectIndicator(
    page,
    'right to left, the last entry',
    rail(page).getByRole('button', { name: 'Create Space', exact: true })
  );
});
