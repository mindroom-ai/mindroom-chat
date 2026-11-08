import { expect, type Locator, type Page } from '@playwright/test';

const RECOVERY_KEY = /^E\w{3}( \w{4}){11}$/;

/**
 * Fills the setup dialog's recovery password and confirmation, continues, answers the account
 * password prompt when the server asks for it (`accountPassword`, by default the recovery
 * password), reveals the recovery key, ticks the saved box and closes with Done. Resolves to the
 * recovery key, for the specs that unlock with it.
 */
export const setUpRecoveryPassword = async (
  page: Page,
  password: string,
  accountPassword = password
): Promise<string> => {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
  await dialog.locator('input[name="recoveryPasswordInput"]').fill(password);
  await dialog.locator('input[name="recoveryPasswordConfirmInput"]').fill(password);
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const saved = dialog.getByRole('checkbox', { name: 'I saved my recovery password' });
  const prompt = page.locator('input[name="passwordInput"]');
  await expect(saved.or(prompt).first()).toBeVisible({ timeout: 60_000 });
  if (await prompt.isVisible()) {
    await prompt.fill(accountPassword);
    await prompt.press('Enter');
  }
  await expect(saved).toBeVisible({ timeout: 60_000 });

  await dialog.getByRole('button', { name: 'Recovery key for other apps' }).click();
  const keyText = dialog.locator('code');
  await expect(keyText).toHaveText(RECOVERY_KEY);
  const recoveryKey = (await keyText.textContent()) ?? '';
  await saved.check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  return recoveryKey;
};

/**
 * Types the recovery password or key into the unlock form inside `scope` (a page, or the dialog
 * that holds it), presses Unlock and waits until it says this device is verified.
 */
export const unlockWithRecovery = async (scope: Page | Locator, secret: string): Promise<void> => {
  await scope.locator('input[name="recoveryInput"]').fill(secret);
  await scope.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(scope.getByText('This device is verified.')).toBeVisible({ timeout: 60_000 });
};
