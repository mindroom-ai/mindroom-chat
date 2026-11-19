/* eslint-disable no-await-in-loop -- Menus share focus and must open sequentially. */
import { expect, test } from '@playwright/test';
import { fingersOn } from '../helpers/fingers';
import { expectFloatingNavHeader, pixelDifference, sampleScreenshot } from '../helpers/glassVisual';

for (const theme of ['silver', 'dark']) {
  test(`pack actions stay below the scrolling title in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&viewer=pack&theme=${theme}`);
    const title = page.locator('header');
    const scroll = title.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
    await page.getByRole('button', { name: 'Both', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Emoji', exact: true }).click();
    const actions = page
      .getByRole('button', { name: 'Apply Changes', exact: true })
      .locator('xpath=../../..');
    await scroll.evaluate((element) => {
      element.scrollTop = 250;
    });
    const expectBelowTitle = async () => {
      await expect
        .poll(async () => {
          const header = (await title.boundingBox())!;
          return (await actions.boundingBox())!.y - header.y - header.height;
        })
        .toBeGreaterThan(0);
    };
    await expectBelowTitle();
    // Follow the measured height when a responsive title gets taller.
    await title.evaluate((element) => {
      element.style.height = '86px';
    });
    await expectBelowTitle();
  });

  test(`short text viewers fill their scrolling canvas in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&viewer=text&theme=${theme}`);
    const pre = page.locator('pre');
    await expect(pre).toHaveText('Short file');
    const text = (await pre.boundingBox())!;
    const viewport = (await pre
      .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]')
      .boundingBox())!;
    const [canvas, right, bottom] = await sampleScreenshot(page, [
      { x: text.x + 4, y: text.y + 8 },
      { x: viewport.x + viewport.width - 20, y: text.y + 8 },
      { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height - 24 },
    ]);
    expect(pixelDifference(canvas!, right!), 'Canvas fills scrollbar gutter').toBeLessThan(3);
    expect(
      pixelDifference(canvas!, bottom!),
      'Canvas fills empty area below short text'
    ).toBeLessThan(3);
  });

  test(`nested titles keep the surrounding panel color in ${theme}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await page.mouse.move(1, 1);
    const bounds = (await title.boundingBox())!;
    // Empty regions above/below the seam must match, not form a separately tinted band.
    const [header, body] = await sampleScreenshot(page, [
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height + 22 },
    ]);
    expect(pixelDifference(header!, body!), 'Header matches its enclosing panel').toBeLessThan(9);
    if (browserName === 'chromium') {
      // A new backdrop root can match the colors by disabling nested blur entirely.
      // Verify painted blur over real scrolling text, not just its computed CSS.
      await scroll.evaluate((element) => {
        element.scrollTop = 145;
      });
      // The dense tint a scrolled title takes would hide the difference; compare the blur alone.
      await title.evaluate((element) => {
        element.style.setProperty('background-color', 'transparent');
      });
      const points = Array.from({ length: 200 }, (_, index) => ({
        x: bounds.x + 24 + (index % 40) * 3,
        y: bounds.y + bounds.height - 18 + Math.floor(index / 40) * 3,
      }));
      const blurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.setProperty('backdrop-filter', 'none'));
      const unblurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.removeProperty('backdrop-filter'));
      await title.evaluate((element) => element.style.removeProperty('background-color'));
      expect(
        blurred.reduce((sum, pixel, index) => sum + pixelDifference(pixel, unblurred[index]!), 0),
        'Scrolling text is visibly blurred beneath the title'
      ).toBeGreaterThan(500);
    }
    await page.emulateMedia({ contrast: 'more' });
    await expect(title).toHaveCSS('backdrop-filter', 'none');
    await expect(title).toHaveCSS('background-color', /^rgb\(/);
  });

  test(`scrolling titles leave the panel rim sharp in ${theme}`, async ({ page }) => {
    test.skip(theme !== 'dark', "Silver's rim is too close to its background to measure");
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    await title.evaluate((element) =>
      Promise.all(
        element
          .closest('body > *')!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    );
    await page.mouse.move(1, 1);
    const bounds = (await title.boundingBox())!;
    // Chromium's title blur otherwise smears the panel's 1px rim into a band along the edge.
    // Sample below the title text and clear of the rounded corner.
    const y = bounds.y + bounds.height - 10;
    const [rim, edge, inner] = await sampleScreenshot(page, [
      { x: bounds.x, y },
      { x: bounds.x + 3, y },
      { x: bounds.x + 24, y },
    ]);
    expect(pixelDifference(rim!, inner!), 'Rim is drawn crisply over the title').toBeGreaterThan(
      60
    );
    expect(pixelDifference(edge!, inner!), 'Title edge matches its interior').toBeLessThan(9);
  });

  test(`custom menus keep flat scrolling titles and keyboard selection in ${theme}`, async ({
    page,
  }, testInfo) => {
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 620 });
      await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
      const trigger = page.getByRole('button', { name: /^Choose model / });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
      // A compact menu above its button, inside the window.
      const menu = (await dialog.boundingBox())!;
      const button = (await trigger.boundingBox())!;
      expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
      // Some models have reasoning levels: their column sits beside the models, under them on a
      // phone.
      expect(menu.width).toBeLessThanOrEqual(width < 750 ? 272 : 272 + 192);
      // 24 models: a filter field above them, which keeps focus and stays while they scroll.
      const search = dialog.getByRole('searchbox', { name: 'Search models' });
      await expect(search).toBeFocused();
      const field = (await search.boundingBox())!;
      const last = dialog.getByRole('option', { name: /^Studio model 24 / });
      const rows = (await dialog.getByRole('listbox').boundingBox())!;
      const viewport = (await dialog.getByRole('listbox').locator('..').boundingBox())!;
      await page.mouse.move(rows.x + rows.width / 2, viewport.y + viewport.height - 24);
      await expect
        .poll(async () => {
          await page.mouse.wheel(0, 400);
          const row = (await last.boundingBox())!;
          return row.y + row.height <= viewport.y + viewport.height;
        })
        .toBe(true);
      expect((await search.boundingBox())!.y).toBe(field.y);
      await expect(search).toBeFocused();
      await page.keyboard.press('ArrowDown');
      const activeId = await search.getAttribute('aria-activedescendant');
      const option = page.locator(`[id="${activeId}"]`);
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.y).toBeGreaterThanOrEqual(field.y + field.height);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: testInfo.outputPath(`models-${width}.png`), scale: 'css' });
      await search.fill('Studio model 24');
      const match = dialog.getByRole('option', { name: /^Studio model 24 / });
      await expect(match).toBeVisible();
      await expect(search).toHaveAttribute(
        'aria-activedescendant',
        (await match.getAttribute('id'))!
      );
      await page.keyboard.press('Enter');
      await expect(page.locator('output')).toHaveText('model-24');
      const aboveButton = async () => {
        const shrunk = (await dialog.boundingBox())!;
        return shrunk.y >= 0 && shrunk.y + shrunk.height <= (await trigger.boundingBox())!.y;
      };
      // A phone's keyboard shrinks the window under the open menu, which stays above its button.
      await page.setViewportSize({ width, height: 420 });
      await expect.poll(aboveButton).toBe(true);
      // Where it pans only the visual viewport, useMobileKeyboardViewportFix shortens #root a
      // frame later. With the button at the foot of #root, as the composer is, the menu follows.
      await page.setViewportSize({ width, height: 620 });
      await trigger.evaluate((button) => {
        document.getElementById('root')!.style.position = 'relative';
        button.closest<HTMLElement>('div[style*="fixed"]')!.style.position = 'absolute';
      });
      await page.evaluate(() =>
        document.documentElement.style.setProperty('--app-height', '360px')
      );
      await expect.poll(async () => (await trigger.boundingBox())!.y).toBeLessThan(360);
      await expect.poll(aboveButton).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await page.setViewportSize({ width: 390, height: 480 });
    const openFilters = page.getByRole('button', { name: 'Open filters' });
    // macOS WebKit does not focus a clicked button, so Escape could not return focus to it.
    await openFilters.focus();
    await openFilters.press('Enter');
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await scroll.evaluate((element) => {
      element.scrollTop = 200;
    });
    await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('thread-filters.png'), scale: 'css' });
    await scroll.getByRole('scrollbar').press('End');
    await page.getByRole('button', { name: 'Filter option 20' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open filters' })).toBeFocused();

    const invite = page.getByRole('textbox', { name: 'Invite search' });
    await invite.focus();
    const inviteHeader = page.locator('header').filter({ hasText: 'Invite people' });
    const inviteScroll = await expectFloatingNavHeader(inviteHeader, { inheritsPanelTint: true });
    // The list covers the dialog's own controls, so it is tinted nearly opaque,
    // and the option Enter picks is filled while the other rows stay clear.
    const inviteList = page.getByRole('listbox', { name: 'People' });
    expect(
      await inviteList.evaluate((element) => {
        const alpha = getComputedStyle(element).backgroundColor.match(/[/,]\s*([\d.]+)\)$/);
        return alpha ? Number(alpha[1]) : 1;
      })
    ).toBeGreaterThanOrEqual(0.9);
    const optionFill = (name: string) =>
      inviteList
        .getByRole('option', { name, exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await optionFill('Studio guest 1')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await optionFill('Studio guest 2')).toBe('rgba(0, 0, 0, 0)');
    const inviteTrack = (await inviteScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(
      inviteTrack.x + inviteTrack.width / 2,
      inviteTrack.y + inviteTrack.height * 0.8
    );
    await expect(invite).toBeFocused();
    expect(await inviteScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await expectFloatingNavHeader(inviteHeader, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('invite-autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(inviteHeader).toBeHidden();

    await page.getByRole('button', { name: 'Open autocomplete' }).click();
    const suggestions = page.locator('header').filter({ hasText: 'Suggestions' });
    const suggestionsScroll = await expectFloatingNavHeader(suggestions, {
      inheritsPanelTint: true,
    });
    const first = page.getByRole('button', { name: 'Suggestion 1', exact: true });
    const last = page.getByRole('button', { name: 'Suggestion 20', exact: true });
    await last.focus();
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    const bounds = (await suggestionsScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.8);
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Suggestion 2', exact: true })).toBeFocused();
    await suggestionsScroll.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expectFloatingNavHeader(suggestions, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(suggestions).toBeHidden();
  });
}

test('the model button is framed like the composer buttons after it, its logo centred', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto('/e2e/fixtures/glass-surfaces.html?menus&effort=0');
  const trigger = page.getByRole('button', { name: /^Choose model / });
  const button = (await trigger.boundingBox())!;
  const attach = (await page.getByRole('button', { name: 'Attach', exact: true }).boundingBox())!;
  expect([button.width, button.height, button.y]).toEqual([attach.width, attach.height, attach.y]);
  const logo = (await trigger.locator('svg').boundingBox())!;
  expect(logo.x - button.x).toBeCloseTo(button.x + button.width - logo.x - logo.width, 1);
  expect(logo.y - button.y).toBeCloseTo(button.y + button.height - logo.y - logo.height, 1);
  // The same glass, not a bare logo.
  const background = (locator: typeof trigger) =>
    locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await background(trigger)).toBe(
    await background(page.getByRole('button', { name: 'Attach', exact: true }))
  );
  // Open, it keeps the pressed tint while the pointer is over it.
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Model for this thread' })).toBeVisible();
  await page.mouse.move(380, 10);
  const pressed = await background(trigger);
  // The menu's overlay takes the pointer, so DevTools holds the button's :hover state instead.
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('DOM.enable');
  await devtools.send('CSS.enable');
  const { root } = await devtools.send('DOM.getDocument');
  const { nodeId } = await devtools.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[aria-haspopup="dialog"][aria-expanded="true"]',
  });
  await devtools.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  expect(await trigger.evaluate((element) => element.matches(':hover'))).toBe(true);
  expect(await background(trigger)).toBe(pressed);
});

test('a short phone window keeps the Effort row under the models, and the levels in their place', async ({
  page,
}, testInfo) => {
  // About 300 px above the model button, as with a phone's keyboard up.
  await page.setViewportSize({ width: 390, height: 364 });
  await page.goto('/e2e/fixtures/glass-surfaces.html?menus&theme=silver');
  const trigger = page.getByRole('button', { name: /^Choose model / });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
  const menu = (await dialog.boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual((await trigger.boundingBox())!.y);
  expect(menu.width).toBeLessThanOrEqual(273);
  await expect(dialog.locator('[data-effort-column]')).toHaveCount(0);
  // The models keep a scrolling list of more than two rows; the row stays at the menu's foot.
  const models = (await dialog.getByRole('listbox').locator('..').boundingBox())!;
  expect(models.height).toBeGreaterThanOrEqual(110);
  const entry = dialog.getByRole('button', { name: 'Effort: Extra high' });
  const pinned = async () => {
    const box = (await entry.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(47.5);
    expect(box.y + box.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
    expect(box.y).toBeGreaterThanOrEqual(models.y + models.height - 1);
  };
  await pinned();
  const lastModel = dialog.getByRole('option', { name: /^Studio model 24 / });
  await lastModel.scrollIntoViewIfNeeded();
  await expect(lastModel).toBeInViewport({ ratio: 1 });
  await pinned();
  await page.screenshot({ path: testInfo.outputPath('short-phone.png'), scale: 'css' });

  // The levels fill the same box, and scroll in it to the last one.
  await entry.click();
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  expect(await dialog.boundingBox()).toEqual(menu);
  await expect(dialog.getByRole('radio', { name: 'Extra high' })).toBeFocused();
  const levels = dialog.getByRole('radio');
  await levels.first().scrollIntoViewIfNeeded();
  await expect(levels.first()).toBeInViewport({ ratio: 1 });
  const first = (await levels.first().boundingBox())!;
  expect(first.y + first.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
  await page.screenshot({ path: testInfo.outputPath('short-phone-levels.png'), scale: 'css' });
  await page.keyboard.press('Escape');
  await expect(entry).toBeFocused();
  await expect(dialog).toBeVisible();
});

test.describe('a phone window with little room above the model button', () => {
  test.use({ hasTouch: true });

  for (const height of [248, 200]) {
    test(`a tap on the Effort row opens the levels, and a tap applies one, with ${
      height - 64
    } px above the model button`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height });
      await page.goto('/e2e/fixtures/glass-surfaces.html?menus&theme=silver');
      const trigger = page.getByRole('button', { name: /^Choose model / });
      await trigger.tap();
      const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
      const menu = (await dialog.boundingBox())!;
      expect(menu.y).toBeGreaterThanOrEqual(0);
      expect(menu.y + menu.height).toBeLessThanOrEqual((await trigger.boundingBox())!.y);
      // The room default runs Studio model 01 at Extra high. Its row shows whole in the menu.
      const entry = dialog.getByRole('button', { name: 'Effort: Extra high' });
      const box = (await entry.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(menu.y);
      expect(box.y + box.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      const low = dialog.getByRole('radio', { name: 'Low', exact: true });
      await low.scrollIntoViewIfNeeded();
      const row = (await low.boundingBox())!;
      expect(row.y).toBeGreaterThanOrEqual(menu.y);
      expect(row.y + row.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
      // Opening the levels sent nothing.
      await expect(page.locator('output')).toHaveText('');
      await page.touchscreen.tap(row.x + row.width / 2, row.y + row.height / 2);
      await expect(page.locator('output')).toHaveText('model-1@low');
    });
  }

  test('with an error over the models, a swipe from it reaches Retry and the models', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 200 });
    await page.goto('/e2e/fixtures/glass-surfaces.html?menus&error&theme=silver');
    const trigger = page.getByRole('button', { name: /^Choose model / });
    await trigger.tap();
    const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
    const menu = (await dialog.boundingBox())!;
    const bar = (await dialog.locator('[data-effort-entry]').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
    // The filter, the error and the models scroll as one box over the Effort row.
    const scrollers = await dialog.evaluate(
      (element) =>
        [...element.querySelectorAll('*')].filter(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight
        ).length
    );
    expect(scrollers).toBe(1);
    const whole = async (box: { y: number; height: number } | null) =>
      !!box && box.y >= menu.y - 1 && box.y + box.height <= bar.y + 1;
    const touch = await fingersOn(page);
    const swipeUntil = async (shown: () => Promise<boolean>) => {
      await expect
        .poll(
          async () => {
            if (await shown()) return true;
            // A finger goes down on the error, or on the box's last line, and pushes it up.
            const alert = await dialog.getByRole('alert').boundingBox();
            const from = alert && (await whole(alert)) ? alert.y + alert.height / 2 : bar.y - 6;
            const to = Math.max(from - 40, menu.y + 4);
            const x = menu.x + menu.width / 2;
            await touch('touchStart', [[1, x, from]]);
            for (let y = from - 8; y >= to; y -= 8) await touch('touchMove', [[1, x, y]]);
            await page.waitForTimeout(150);
            await touch('touchMove', [[1, x, to]]);
            await touch('touchEnd', []);
            return shown();
          },
          { timeout: 30_000, intervals: [50] }
        )
        .toBe(true);
    };
    const retry = dialog.getByRole('button', { name: 'Retry' });
    await swipeUntil(async () => whole(await retry.boundingBox()));
    const button = (await retry.boundingBox())!;
    // Opening the menu asked once; Retry asks again.
    await expect(page.locator('main')).toHaveAttribute('data-refreshes', '1');
    await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
    await expect(page.locator('main')).toHaveAttribute('data-refreshes', '2');
    const model = dialog.getByRole('option', { name: /^Studio model 01 / });
    await swipeUntil(async () => whole(await model.boundingBox()));
    const row = (await model.boundingBox())!;
    await page.touchscreen.tap(row.x + row.width / 2, row.y + row.height / 2);
    await expect(page.locator('output')).toHaveText('model-1');
  });
});
