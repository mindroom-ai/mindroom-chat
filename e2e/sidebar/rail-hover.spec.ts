import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateSpace, matrixFetch, setAccountData } from '../helpers/matrix';

// Hovering any rail entry slides its button 2 px toward the inline end and grows the indicator
// on the rail's outer edge to 18 px; a selected entry reacts the same way: it slides too and
// its 24 px indicator grows to 32 px.
// The indicators must reach the screen, at the top of the rail and in its bottom group alike.
// Keyboard focus looks like hover, pressing keeps the slide and shrinks the button a little, and
// reduced motion keeps the indicator only. Set RAIL_HOVER_SHOTS=<directory> to also save the
// screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'rail-hover-spec-password';
const SHOTS = process.env.RAIL_HOVER_SHOTS;

/** The slide, the press scale and the indicator heights the rail promises. */
const SLIDE = 2;
const PRESS_SCALE = 0.95;
const HOVER_HEIGHT = 18;
const SELECTED_HEIGHT = 24;
const SELECTED_HOVER_HEIGHT = 32;

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  // The rail's optional buttons, which this spec hovers, are off until an account turns them on.
  await setAccountData(HOMESERVER, body.access_token, body.user_id, 'io.mindroom.settings', {
    showThreadsInSidebar: true,
    showExploreInSidebar: true,
    showCreateSpaceInSidebar: true,
    showSearchInSidebar: true,
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

/** Matrix canonical JSON: sorted keys, no whitespace. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const unpaddedBase64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

type SigningKey = { id: string; privateKey: KeyObject };

const signingKey = (): SigningKey => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url');
  return { id: unpaddedBase64(raw), privateKey };
};

const crossSigningKey = (userId: string, usage: string, key: SigningKey, signer?: SigningKey) => {
  const body = { user_id: userId, usage: [usage], keys: { [`ed25519:${key.id}`]: key.id } };
  if (!signer) return body;
  const signature = unpaddedBase64(sign(null, Buffer.from(canonical(body)), signer.privateKey));
  return { ...body, signatures: { [userId]: { [`ed25519:${signer.id}`]: signature } } };
};

/**
 * Publishes cross-signing keys for the account, so a browser session that signs in afterwards
 * is not verified and the rail shows its Unverified Device button.
 */
const publishCrossSigning = async ({ username, userId, accessToken }: Account) => {
  const master = signingKey();
  const keys = {
    master_key: crossSigningKey(userId, 'master', master),
    self_signing_key: crossSigningKey(userId, 'self_signing', signingKey(), master),
    user_signing_key: crossSigningKey(userId, 'user_signing', signingKey(), master),
  };
  const upload = (auth?: Record<string, unknown>) =>
    fetch(`${HOMESERVER}/_matrix/client/v3/keys/device_signing/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(auth ? { ...keys, auth } : keys),
    });
  let response = await upload();
  if (response.status === 401) {
    const { session } = (await response.json()) as { session?: string };
    response = await upload({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password: PASSWORD,
      session,
    });
  }
  expect(response.ok, `device_signing/upload answered ${response.status}`).toBe(true);
};

/** A space at the top of the rail and a folder of two more. */
const createRailSpaces = async ({ userId, accessToken }: Account) => {
  const space = await createPrivateSpace(HOMESERVER, accessToken, {
    name: 'Rail Space',
    topic: '',
  });
  const inFolder = [
    await createPrivateSpace(HOMESERVER, accessToken, { name: 'Folder Alpha', topic: '' }),
    await createPrivateSpace(HOMESERVER, accessToken, { name: 'Folder Beta', topic: '' }),
  ];
  await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.spaces', {
    sidebar: [space, { id: 'rail-hover-folder', name: 'Rail Folder', content: inFolder }],
  });
  return space;
};

/** `count` spaces, enough to make the rail's top part scroll. Returns their IDs in order. */
const createManySpaces = async ({ accessToken }: Account, count: number) => {
  const ids: string[] = [];
  for (let start = 0; start < count; start += 5) {
    const batch = Array.from({ length: Math.min(5, count - start) }, (_, offset) =>
      createPrivateSpace(HOMESERVER, accessToken, {
        name: `Rail Space ${String(start + offset + 1).padStart(2, '0')}`,
        topic: '',
      })
    );
    ids.push(...(await Promise.all(batch)));
  }
  return ids;
};

const signIn = async (page: Page, account: Account) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

/** The rail entry (the element with the indicator) that holds a button. */
const entryOf = (button: Locator) => button.locator('xpath=..');

/**
 * The button's centre: raised glass buttons also grow 2.5% on hover, which moves their edges by
 * half a pixel but not their centre.
 */
const centre = async (button: Locator) => {
  const box = await button.boundingBox();
  return box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: Number.NaN, y: Number.NaN };
};

/** The entry's indicator as drawn: its height after scaling, its edges, and its transition. */
const indicator = (entry: Locator) =>
  entry.evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const left = element.getBoundingClientRect().left + parseFloat(style.left);
    return {
      height: parseFloat(style.height) * matrix.d,
      width: parseFloat(style.width),
      // `left` resolves to the used offset in either direction.
      left,
      right: left + parseFloat(style.width),
      transitionProperty: style.transitionProperty,
      transitionSeconds: parseFloat(style.transitionDuration),
    };
  });

/**
 * The indicator as it reaches the screen at the rail's outer edge: whether the pointer finds the
 * entry there (nothing covers or clips it), and how many pixel rows of the edge's 4 px column
 * stand out from the rail above and below the indicator. An indicator moved off the edge, or
 * cut off by a scroller, counts 0 rows. Left to right only.
 */
const drawnIndicator = async (page: Page, entry: Locator) => {
  const { left, top, uncovered } = await entry.evaluate((element) => {
    const railEdge = element.closest('nav')?.getBoundingClientRect().left ?? 0;
    const box = element.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    return {
      left: railEdge,
      top: middle - 20,
      uncovered: [-6, 0, 6].every(
        (offset) => document.elementFromPoint(railEdge + 2, middle + offset) === element
      ),
    };
  });
  const png = await page.screenshot({
    clip: { x: left, y: top, width: 4, height: 40 },
    scale: 'css',
  });
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
      const [r = 0, g = 0, b = 0] = pixels.subarray(at, at + 3);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    // The rail itself, 2 px into the window: a 24 px indicator leaves 8 rows above it.
    const rail = luminance(2);
    let drawn = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (Math.abs(luminance(y) - rail) > 40) drawn += 1;
    }
    return drawn;
  }, png.toString('base64'));
  return { uncovered, rows };
};

/** A button's computed `scale` and how long a change of it takes to ease in, in seconds. */
const scaleOf = (button: Locator) =>
  button.evaluate((element) => {
    const style = getComputedStyle(element);
    const properties = style.transitionProperty.split(',').map((name) => name.trim());
    const durations = style.transitionDuration.split(',').map((value) => parseFloat(value));
    const index = properties.indexOf('scale');
    return { scale: style.scale, seconds: index < 0 ? 0 : durations[index] ?? 0 };
  });

/** Waits for the slide and the indicator's transitions (160 and 200 ms) to land. */
const settle = (page: Page) => page.waitForTimeout(400);

const pointerAway = async (page: Page) => {
  await page.mouse.move(700, 450);
  await settle(page);
};

/** Opens the Activity page from the rail's bell, whose popover offers Open as page. */
const openActivityPage = async (page: Page, bell: Locator) => {
  await bell.click();
  const popover = page.getByRole('dialog', { name: 'Activity' });
  await popover.getByRole('button', { name: 'Open as page', exact: true }).click();
  await expect(page).toHaveURL(/\/activity\/$/);
  await expect(popover).toBeHidden();
};

/** Hovers the button and returns how its centre moved and how its indicator looked. */
const hoverAndMeasure = async (page: Page, button: Locator) => {
  const entry = entryOf(button);
  await pointerAway(page);
  const restCentre = await centre(button);
  const rest = await indicator(entry);
  const selected = (await entry.getAttribute('data-active')) !== null;
  await button.hover();
  await settle(page);
  const hoverCentre = await centre(button);
  const hover = await indicator(entry);
  const drawn = await drawnIndicator(page, entry);
  await pointerAway(page);
  const after = await indicator(entry);
  const afterDrawn = await drawnIndicator(page, entry);
  return {
    selected,
    dx: hoverCentre.x - restCentre.x,
    dy: hoverCentre.y - restCentre.y,
    rest,
    hover,
    drawn,
    after,
    afterDrawn,
  };
};

/** The indicator reaches the screen at about `height` px and nothing covers it. */
const expectDrawn = (
  name: string,
  drawn: Awaited<ReturnType<typeof drawnIndicator>>,
  height: number
) => {
  expect(drawn.uncovered, `${name} indicator uncovered`).toBe(true);
  expect(
    Math.abs(drawn.rows - height),
    `${name} indicator on screen: ${drawn.rows} px`
  ).toBeLessThanOrEqual(2);
};

/** One hover's checks, for a selected entry or not. */
const expectHover = (name: string, measured: Awaited<ReturnType<typeof hoverAndMeasure>>) => {
  const { selected, dx, dy, rest, hover, drawn, after, afterDrawn } = measured;
  // A slide toward the inline end, no lift.
  expect(dx, `${name} slide`).toBeCloseTo(SLIDE, 0);
  expect(Math.abs(dy), `${name} vertical move`).toBeLessThan(0.6);
  // The indicator grows and shrinks by a transition of its transform.
  expect(hover.transitionProperty, `${name} indicator transition`).toContain('transform');
  expect(hover.transitionSeconds, `${name} indicator transition`).toBeGreaterThanOrEqual(0.1);
  if (selected) {
    expect(rest.height, `${name} selected rest`).toBeCloseTo(SELECTED_HEIGHT, 0);
    expect(hover.height, `${name} selected hover`).toBeCloseTo(SELECTED_HOVER_HEIGHT, 0);
    expectDrawn(`${name} selected hover`, drawn, SELECTED_HOVER_HEIGHT);
    expect(after.height, `${name} selected after`).toBeCloseTo(SELECTED_HEIGHT, 0);
    expectDrawn(`${name} selected after`, afterDrawn, SELECTED_HEIGHT);
  } else {
    expect(rest.height, `${name} rest`).toBeCloseTo(0, 1);
    expect(hover.height, `${name} hover`).toBeCloseTo(HOVER_HEIGHT, 0);
    expectDrawn(`${name} hover`, drawn, HOVER_HEIGHT);
    expect(after.height, `${name} after`).toBeCloseTo(0, 1);
    // The screen check can tell: once the pointer leaves, the edge is bare again.
    expect(afterDrawn.rows, `${name} indicator gone`).toBeLessThanOrEqual(1);
  }
};

// Headless Chromium hides scrollbars (`--hide-scrollbars`); desktop browsers with classic
// scrollbars show them, and a scrollbar takes width from the rail. The other launch options
// repeat playwright.config.ts.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('every rail entry slides toward the inline end and grows its indicator on hover', async ({
  page,
}) => {
  test.slow();
  const account = await register('rail_hover');
  await publishCrossSigning(account);
  const spaceId = await createRailSpaces(account);
  await signIn(page, account);

  const space = rail(page).locator(`button[data-id="${spaceId}"]`);
  const named: Record<string, Locator> = {
    Home: rail(page).getByRole('button', { name: 'Home', exact: true }),
    'Direct Messages': rail(page).getByRole('button', { name: 'Direct Messages' }),
    Threads: rail(page).getByRole('button', { name: 'Threads', exact: true }),
    'a space': space,
    'a folder': rail(page).getByRole('button', { name: 'Rail Folder' }),
    Explore: rail(page).getByRole('button', { name: 'Explore Community' }),
    Create: rail(page).getByRole('button', { name: 'Create Space' }),
    Search: rail(page).getByRole('button', { name: 'Open command palette' }),
    'device verification': rail(page).getByRole('button', { name: 'Unverified Device' }),
    Activity: rail(page).getByRole('button', { name: /^Activity/ }),
    account: rail(page).getByRole('button', { name: /Open account menu for / }),
    collapse: rail(page).getByRole('button', { name: 'Collapse navigation panel' }),
  };
  for (const [name, button] of Object.entries(named)) {
    await expect(button, `${name} on the rail`).toBeVisible({ timeout: 30_000 });
  }

  // Every visible rail button, named above or not.
  const buttons = rail(page).getByRole('button');
  const count = await buttons.count();
  let checked = 0;
  let selectedChecked = 0;
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible())) continue;
    const name =
      (await button.getAttribute('aria-label')) ??
      (await button.getAttribute('data-id')) ??
      `button ${index}`;
    const measured = await hoverAndMeasure(page, button);
    expectHover(name, measured);
    checked += 1;
    if (measured.selected) selectedChecked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(Object.keys(named).length);
  // Home on the landing page and the account, which always carries the selection mark.
  expect(selectedChecked).toBeGreaterThanOrEqual(2);

  // A selected space reacts to the pointer like an unselected one: the same slide, and its
  // indicator grows too.
  await space.click();
  await expect(entryOf(space)).toHaveAttribute('data-active', 'true');
  const selectedSpace = await hoverAndMeasure(page, space);
  expect(selectedSpace.selected).toBe(true);
  expectHover('selected space', selectedSpace);
  const unselected = await hoverAndMeasure(page, named.Home ?? space);
  expect(unselected.selected, 'Home, no longer selected').toBe(false);
  expect(selectedSpace.dx, 'selected and unselected slide alike').toBeCloseTo(unselected.dx, 0);
  expect(selectedSpace.hover.height - selectedSpace.rest.height, 'selected grows').toBeCloseTo(
    SELECTED_HOVER_HEIGHT - SELECTED_HEIGHT,
    0
  );
  expect(unselected.hover.height - unselected.rest.height, 'unselected grows').toBeCloseTo(
    HOVER_HEIGHT,
    0
  );
});

test('the bottom group shows its indicators while Activity or Search is open', async ({ page }) => {
  test.slow();
  const account = await register('rail_hover_d');
  await publishCrossSigning(account);
  await signIn(page, account);

  const search = rail(page).getByRole('button', { name: 'Open command palette' });
  const activity = rail(page).getByRole('button', { name: /^Activity/ });
  const bottom: Record<string, Locator> = {
    Search: search,
    'device verification': rail(page).getByRole('button', { name: 'Unverified Device' }),
    Activity: activity,
    account: rail(page).getByRole('button', { name: /Open account menu for / }),
    collapse: rail(page).getByRole('button', { name: 'Collapse navigation panel' }),
  };
  for (const [name, button] of Object.entries(bottom)) {
    await expect(button, `${name} on the rail`).toBeVisible({ timeout: 30_000 });
  }

  // Activity open: its tall indicator shows at rest and on hover; the others still grow theirs.
  await openActivityPage(page, activity);
  await expect(entryOf(activity)).toHaveAttribute('data-active', 'true');
  await pointerAway(page);
  expectDrawn('Activity open', await drawnIndicator(page, entryOf(activity)), SELECTED_HEIGHT);
  for (const [name, button] of Object.entries(bottom)) {
    expectHover(`${name} with Activity open`, await hoverAndMeasure(page, button));
  }

  // Search open: the command palette's backdrop covers the rail, and the tall indicator shows
  // through it.
  await search.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(entryOf(search)).toHaveAttribute('data-active', 'true');
  await settle(page);
  const searchOpen = await drawnIndicator(page, entryOf(search));
  expect(
    Math.abs(searchOpen.rows - SELECTED_HEIGHT),
    `Search open: ${searchOpen.rows} px`
  ).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(entryOf(search)).not.toHaveAttribute('data-active', 'true');
});

test('focus, pressing, reduced motion and right to left', async ({ page }) => {
  test.slow();
  const account = await register('rail_hover_b');
  await signIn(page, account);

  const explore = rail(page).getByRole('button', { name: 'Explore Community' });
  const create = rail(page).getByRole('button', { name: 'Create Space' });
  const entry = entryOf(explore);
  const railBox = await rail(page).boundingBox();
  await pointerAway(page);
  const rest = await centre(explore);

  // Keyboard focus looks like hover.
  await create.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(explore).toBeFocused();
  expect(await explore.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await settle(page);
  expect((await centre(explore)).x - rest.x, 'focus slide').toBeCloseTo(SLIDE, 0);
  expect((await indicator(entry)).height, 'focus indicator').toBeCloseTo(HOVER_HEIGHT, 0);
  await explore.blur();
  await settle(page);
  expect((await indicator(entry)).height).toBeCloseTo(0, 1);

  // The indicator sits flush with the rail's leading edge; the button slides away from it and
  // leaves a clear gap.
  await explore.hover();
  await settle(page);
  const hovered = await indicator(entry);
  expect(hovered.left).toBeCloseTo(railBox?.x ?? 0, 0);
  expect((await centre(explore)).x - rest.x).toBeCloseTo(SLIDE, 0);
  expect(((await explore.boundingBox())?.x ?? 0) - hovered.right, 'gap').toBeGreaterThan(8);
  const entryBox = await entry.boundingBox();
  const resting = await scaleOf(explore);

  // Pressing keeps the slide and quickly shrinks the button a little; the entry and its
  // indicator stay put. Releasing away from the button does not click it, and it eases back.
  await page.mouse.down();
  expect((await scaleOf(explore)).seconds, 'press transition').toBeLessThanOrEqual(0.1);
  await settle(page);
  expect((await scaleOf(explore)).scale).toBe(String(PRESS_SCALE));
  expect((await explore.boundingBox())?.width).toBeCloseTo(42 * PRESS_SCALE, 0);
  expect((await centre(explore)).x - rest.x, 'press slide').toBeCloseTo(SLIDE, 0);
  expect(await entry.boundingBox()).toEqual(entryBox);
  expect((await indicator(entry)).height, 'press indicator').toBeCloseTo(HOVER_HEIGHT, 0);
  await page.mouse.move(700, 450);
  await page.mouse.up();
  expect((await scaleOf(explore)).seconds, 'release transition').toBeCloseTo(resting.seconds, 2);
  expect(resting.seconds).toBeGreaterThanOrEqual(0.15);
  await settle(page);
  expect((await scaleOf(explore)).scale).not.toBe(String(PRESS_SCALE));

  // Reduced motion: no slide and no press, the indicator still shows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pointerAway(page);
  await explore.hover();
  await settle(page);
  expect((await centre(explore)).x).toBeCloseTo(rest.x, 0);
  expect((await indicator(entry)).height).toBeCloseTo(HOVER_HEIGHT, 0);
  await page.mouse.down();
  await settle(page);
  expect((await scaleOf(explore)).scale).toBe('none');
  expect((await centre(explore)).x).toBeCloseTo(rest.x, 0);
  await page.mouse.move(700, 450);
  await page.mouse.up();

  // Right to left: the indicator moves to the rail's trailing (right) edge and the button slides
  // left, away from it.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  await pointerAway(page);
  const rtlRail = await rail(page).boundingBox();
  const rtlRest = await centre(explore);
  await explore.hover();
  await settle(page);
  const rtlIndicator = await indicator(entry);
  expect(rtlIndicator.right).toBeCloseTo((rtlRail?.x ?? 0) + (rtlRail?.width ?? 0), 0);
  expect(rtlIndicator.height).toBeCloseTo(HOVER_HEIGHT, 0);
  expect((await centre(explore)).x - rtlRest.x).toBeCloseTo(-SLIDE, 0);
  expect(rtlRail?.x).toBeGreaterThan(railBox?.x ?? 0);

  // Holding Space on a focused rail button presses it too.
  await pointerAway(page);
  await explore.focus();
  await page.keyboard.down('Space');
  await settle(page);
  expect((await scaleOf(explore)).scale).toBe(String(PRESS_SCALE));
  await page.keyboard.up('Space');
});

/** The scrolling part and the bottom group share one centre line, to half a pixel. */
const expectOnLine = (name: string, x: number, line: number) =>
  expect.soft(Math.abs(x - line), `${name} at ${x}, the line at ${line}`).toBeLessThanOrEqual(0.5);

test.describe('with more spaces than the rail can show', () => {
  test("the scrolling part keeps the bottom group's centre line and shows its indicators", async ({
    page,
  }) => {
    test.slow();
    const account = await register('rail_hover_e');
    const spaces = await createManySpaces(account, 26);
    await signIn(page, account);

    const home = rail(page).getByRole('button', { name: 'Home', exact: true });
    const activity = rail(page).getByRole('button', { name: /^Activity/ });
    const deepest = rail(page).locator(`button[data-id="${spaces.at(-1) ?? ''}"]`);
    await expect(deepest).toBeAttached({ timeout: 30_000 });
    await expect(entryOf(home)).toHaveAttribute('data-active', 'true');

    // The rail's scrolling part overflows, so it scrolls. It holds the spaces in either layout;
    // Home sits above it while the top group is pinned.
    const scroller = await deepest.evaluate((element) => {
      let box = element.parentElement;
      while (box && getComputedStyle(box).overflowY === 'visible') box = box.parentElement;
      return {
        overflow: box ? box.scrollHeight - box.clientHeight : 0,
        scrollbar: box ? box.offsetWidth - box.clientWidth : 0,
      };
    });
    expect(scroller.overflow, 'the scrolling part overflows').toBeGreaterThan(200);
    // Scrollbars take width here (the launch options above); the rail's must not.
    expect.soft(scroller.scrollbar, 'the scrolling part shows no scrollbar').toBe(0);

    // One centre line for the scrolling part and the bottom group.
    await pointerAway(page);
    const activityCentre = (await centre(activity)).x;
    expectOnLine('Home', (await centre(home)).x, activityCentre);

    // The selected Home's indicator shows at the rail's edge.
    expectDrawn('selected Home', await drawnIndicator(page, entryOf(home)), SELECTED_HEIGHT);

    // Scrolled to the deepest space: on the centre line, and hovering shows its indicator.
    await deepest.scrollIntoViewIfNeeded();
    await pointerAway(page);
    expectOnLine('the deepest space', (await centre(deepest)).x, activityCentre);
    const measured = await hoverAndMeasure(page, deepest);
    expectHover('the deepest space, scrolled', measured);

    // Right to left: the same, mirrored, with the indicator at the right edge.
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await pointerAway(page);
    const rtlActivity = (await centre(activity)).x;
    expectOnLine('right to left, the deepest space', (await centre(deepest)).x, rtlActivity);
    await deepest.hover();
    await settle(page);
    const rtlEdge = await entryOf(deepest).evaluate((element) => {
      const railBox = element.closest('nav')?.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const x = (railBox?.right ?? 0) - 2;
      return document.elementFromPoint(x, box.top + box.height / 2) === element;
    });
    expect(rtlEdge, 'right to left indicator at the right edge').toBe(true);
  });
});

test('saves the rail at rest, hovered and selected, light and dark', async ({ page }) => {
  test.skip(!SHOTS, 'Set RAIL_HOVER_SHOTS=<directory> to save the screenshots');
  test.slow();
  const account = await register('rail_hover_c');
  await createRailSpaces(account);
  await signIn(page, account);

  const theme = async (themeId: string) => {
    await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
      );
    }, themeId);
    await page.reload();
    await expect(rail(page)).toBeVisible({ timeout: 60_000 });
    // The shell renders from the store with a catching-up bar above it until the first sync.
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  };
  const shot = async (name: string) => {
    const box = await rail(page).boundingBox();
    await page.screenshot({
      path: `${SHOTS}/L6-rail-hover-${name}.png`,
      clip: { x: 0, y: 0, width: 140, height: Math.min(box?.height ?? 500, 520) },
    });
  };
  /** The rail's bottom group, from just above Search to the foot of the rail. */
  const bottomShot = async (name: string) => {
    const box = await rail(page).boundingBox();
    const search = await rail(page)
      .getByRole('button', { name: 'Open command palette' })
      .boundingBox();
    const y = Math.max(0, (search?.y ?? 0) - 24);
    await page.screenshot({
      path: `${SHOTS}/L6-rail-hover-${name}.png`,
      clip: { x: 0, y, width: 140, height: (box?.y ?? 0) + (box?.height ?? 900) - y },
    });
  };

  for (const [themeId, label] of [
    ['light-theme', 'light'],
    ['dark-theme', 'dark'],
  ] as const) {
    await theme(themeId);
    const home = rail(page).getByRole('button', { name: 'Home', exact: true });
    await expect(entryOf(home)).toHaveAttribute('data-active', 'true');
    await pointerAway(page);
    await shot(`rest-${label}`);
    // Direct Messages is not selected: it slides and shows the hover indicator.
    await rail(page).getByRole('button', { name: 'Direct Messages' }).hover();
    await settle(page);
    await shot(`hover-${label}`);
    // Home is selected on the landing page: it slides and keeps its tall indicator.
    await pointerAway(page);
    await home.hover();
    await settle(page);
    await shot(`selected-${label}`);
    // The bottom group: Activity hovered beside the account's selection mark, then Activity open.
    const activity = rail(page).getByRole('button', { name: /^Activity/ });
    await pointerAway(page);
    await activity.hover();
    await settle(page);
    await bottomShot(`bottom-hover-${label}`);
    await openActivityPage(page, activity);
    await expect(entryOf(activity)).toHaveAttribute('data-active', 'true');
    await pointerAway(page);
    await bottomShot(`activity-selected-${label}`);
    await home.click();
    await expect(entryOf(home)).toHaveAttribute('data-active', 'true');
  }
});
