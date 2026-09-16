import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix } from '../helpers/matrix';

test.describe('command palette', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('filters without losing text, follows pointer selection, and opens the chosen room', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomName = `Palette navigation ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: roomName,
      topic: 'A room for command palette navigation checks',
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();

    await input.fill(roomName);
    await dialog.getByRole('button', { name: 'Rooms', exact: true }).click();
    await expect(input).toHaveValue(`# ${roomName}`);
    await expect(input).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Rooms', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(dialog.getByRole('option').filter({ hasText: roomName })).toBeVisible();
    await expect(dialog.locator('[role="option"]:not([data-kind="room"])')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(input).toHaveValue(roomName);
    await input.fill('');
    const firstSelectedId = await input.getAttribute('aria-activedescendant');
    await dialog.getByRole('listbox').evaluate((list) => {
      const scroll = list.parentElement!;
      scroll.scrollTop = scroll.scrollHeight;
    });
    await input.fill(' ');
    await expect(input).toHaveAttribute('aria-activedescendant', firstSelectedId!);
    await expect(dialog.getByRole('option', { selected: true })).toBeInViewport();
    await input.press('ArrowUp');
    const selected = dialog.getByRole('option', { selected: true });
    await expect(selected).toBeInViewport();
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      (await selected.getAttribute('id'))!
    );
    await expect(input).toBeFocused();

    await input.fill(roomName);
    const target = dialog.getByRole('option').filter({ hasText: roomName }).first();
    await target.hover();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomId)));
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`keeps mobile search and dismissal visible at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await loginWithPassword(page, { homeserver: getHomeserver(), ...getPrimaryCredentials() });
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
      const input = dialog.getByRole('combobox');
      await expect(input).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Close command palette' })).toBeInViewport();
      await expect(dialog.getByRole('status')).toBeInViewport();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      const shellCornerRadii = await dialog.evaluate((element) => {
        const shell = element.parentElement;
        if (!shell) throw new Error('Command palette shell is missing');
        const style = getComputedStyle(shell);
        return {
          topLeft: Number.parseFloat(style.borderTopLeftRadius),
          topRight: Number.parseFloat(style.borderTopRightRadius),
          bottomLeft: Number.parseFloat(style.borderBottomLeftRadius),
          bottomRight: Number.parseFloat(style.borderBottomRightRadius),
        };
      });
      expect(shellCornerRadii.bottomLeft).toBeGreaterThan(0);
      expect(shellCornerRadii.bottomRight).toBeGreaterThan(0);
      expect(shellCornerRadii.bottomLeft).toBe(shellCornerRadii.topLeft);
      expect(shellCornerRadii.bottomRight).toBe(shellCornerRadii.topRight);
      await page.screenshot({ path: testInfo.outputPath('rounded-command-palette.png') });

      await dialog.getByRole('button', { name: 'Spaces', exact: true }).click();
      await expect(input).toHaveValue('* ');
      await expect(input).toBeFocused();
      await input.fill('> zxqnotfound');
      await expect(dialog.getByRole('option')).toHaveCount(0);
      await expect(input).not.toHaveAttribute('aria-activedescendant');
      await dialog.getByRole('button', { name: 'Clear search' }).click();
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await dialog.getByRole('button', { name: 'Close command palette' }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
});
