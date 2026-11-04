import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';

// Hovering a rail button lifts it a little and shows the small indicator on the rail's outer
// edge; a selected entry keeps its tall indicator; reduced motion keeps the indicator only.
// Set RAIL_HOVER_SHOTS=<directory> to also save the rest, hover and selected screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'rail-hover-spec-password';
const SHOTS = process.env.RAIL_HOVER_SHOTS;

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

const register = async (username: string) => {
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

/** The rail entry (the element with the indicator) that holds a button. */
const entryOf = (button: Locator) => button.locator('xpath=..');

/**
 * The button's vertical centre: raised glass buttons also grow 2.5% on hover, which moves their
 * top edge by half a pixel but not their centre.
 */
const top = async (button: Locator) => {
  const box = await button.boundingBox();
  return box ? box.y + box.height / 2 : Number.NaN;
};

/** The entry's indicator: its computed transform matrix and its resting height. */
const pill = (entry: Locator) =>
  entry.evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    return {
      scaleY: matrix.d,
      height: parseFloat(style.height),
      width: parseFloat(style.width),
      // `left` resolves to the used offset in either direction.
      left: element.getBoundingClientRect().left + parseFloat(style.left),
    };
  });

/** Waits for the lift's transition to land (the entry settles after 160 ms). */
const settle = (page: Page) => page.waitForTimeout(400);

const buttonNames = [
  'Home',
  'Direct Messages',
  'Threads',
  'Explore Community',
  /Open account menu for /,
];

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('hovering a rail button lifts it and shows the small indicator', async ({ page }) => {
  test.slow();
  const username = `rail_hover_${Date.now().toString(36)}`;
  await register(username);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(700, 450);

  const buttons = rail(page).getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(5);

  const seen: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible())) continue;
    const entry = entryOf(button);
    await page.mouse.move(700, 450);
    await settle(page);
    const restTop = await top(button);
    const restPill = await pill(entry);
    const selected = (await entry.getAttribute('data-active')) !== null;
    const name = (await button.getAttribute('aria-label')) ?? `button ${index}`;

    await button.hover();
    await settle(page);
    const hoverTop = await top(button);
    const hoverPill = await pill(entry);
    seen.push(name);

    // A 2 px lift, no sideways move, an indicator that is shorter than the selected one.
    expect(restTop - hoverTop, `${name} lift`).toBeGreaterThanOrEqual(1.5);
    expect(restTop - hoverTop, `${name} lift`).toBeLessThanOrEqual(2.5);
    if (selected) {
      expect(restPill.scaleY, `${name} selected rest`).toBeCloseTo(1.5, 1);
      expect(hoverPill.scaleY, `${name} selected hover`).toBeCloseTo(1.5, 1);
    } else {
      expect(restPill.scaleY, `${name} rest`).toBeCloseTo(0, 2);
      expect(hoverPill.scaleY, `${name} hover`).toBeGreaterThan(0.4);
      expect(hoverPill.scaleY, `${name} hover`).toBeLessThan(1.5);
    }
  }
  expect(seen.length).toBeGreaterThanOrEqual(5);
  for (const name of buttonNames) {
    await expect(rail(page).getByRole('button', { name })).toBeVisible();
  }
});

test('the indicator stays on the rail edge and the lift obeys reduced motion and pressing', async ({
  page,
}) => {
  test.slow();
  const username = `rail_hover_b_${Date.now().toString(36)}`;
  await register(username);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.setViewportSize({ width: 1440, height: 900 });

  const explore = rail(page).getByRole('button', { name: 'Explore Community' });
  const entry = entryOf(explore);
  const railBox = await rail(page).boundingBox();
  await page.mouse.move(700, 450);
  await settle(page);
  const restTop = await top(explore);

  // The indicator sits flush with the rail's leading edge.
  await explore.hover();
  await settle(page);
  expect((await pill(entry)).left).toBeCloseTo(railBox?.x ?? 0, 0);

  // Pressing settles the button back down.
  await page.mouse.down();
  await settle(page);
  expect(await top(explore)).toBeCloseTo(restTop, 0);
  await page.mouse.up();
  await page.keyboard.press('Escape');

  // Reduced motion: no lift, the indicator still shows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(700, 450);
  await settle(page);
  await explore.hover();
  await settle(page);
  expect(await top(explore)).toBeCloseTo(restTop, 0);
  expect((await pill(entry)).scaleY).toBeGreaterThan(0.4);

  // Right to left: the indicator moves to the rail's trailing (right) edge.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  await settle(page);
  const rtlRail = await rail(page).boundingBox();
  const rtlEntry = await entry.boundingBox();
  const rtlPill = await pill(entry);
  expect(rtlPill.left + rtlPill.width).toBeCloseTo((rtlRail?.x ?? 0) + (rtlRail?.width ?? 0), 0);
  expect(rtlEntry?.x).toBeGreaterThan(railBox?.x ?? 0);
});

test('saves the rail at rest, hovered and selected, light and dark', async ({ page }) => {
  test.skip(!SHOTS, 'Set RAIL_HOVER_SHOTS=<directory> to save the screenshots');
  test.slow();
  const username = `rail_hover_c_${Date.now().toString(36)}`;
  await register(username);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.setViewportSize({ width: 1440, height: 900 });

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
  };
  const shot = async (name: string) => {
    const box = await rail(page).boundingBox();
    await page.screenshot({
      path: `${SHOTS}/L6-rail-hover-${name}.png`,
      clip: { x: 0, y: 0, width: 140, height: Math.min(box?.height ?? 500, 520) },
    });
  };

  for (const [themeId, label] of [
    ['light-theme', 'light'],
    ['dark-theme', 'dark'],
  ] as const) {
    await theme(themeId);
    const explore = rail(page).getByRole('button', { name: 'Explore Community' });
    await page.mouse.move(700, 450);
    await settle(page);
    await shot(`rest-${label}`);
    await explore.hover();
    await settle(page);
    await shot(`hover-${label}`);
    // The Home entry is selected on the landing page; its tall indicator shows at rest.
    await page.mouse.move(700, 450);
    await settle(page);
    await shot(`selected-${label}`);
  }
});
