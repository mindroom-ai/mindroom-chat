import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

test('Escape closes schedules without marking the room read', async ({ page }) => {
  await page.goto('/e2e/fixtures/room-schedules.html');
  await page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Read receipts sent')).toHaveText('0');
  // Prove the real room shortcut is active once focus leaves the modal.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Read receipts sent')).toHaveText('1');
});

test('room schedule accordion filters, formats prompts, reveals details, and follows live updates', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/room-schedules.html');
  const trigger = page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Scheduled tasks' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(3);
  await expect(dialog.getByText('Cancelled reminder', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Completed reminder', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Awaiting execution', { exact: true })).toBeVisible();
  await expect(dialog.getByText('New thread', { exact: true })).toBeVisible();

  // Type filter bar switches between All, One-time, and Recurring; single match auto-expands.
  const filterGroup = dialog.getByRole('group', { name: 'Filter scheduled tasks' });
  await filterGroup.getByRole('button', { name: /^Recurring/ }).click();
  await expect(dialog.getByRole('article')).toHaveCount(1);

  const morningCard = dialog.getByRole('article').first();
  await expect(morningCard.locator('code')).toHaveText('inbox');
  await expect(morningCard.getByText('@helper', { exact: true })).toBeVisible();
  await expect(morningCard.getByText('Silent', { exact: true })).toBeVisible();
  await expect(morningCard.getByText('No history', { exact: true })).toBeVisible();
  await expect(morningCard.getByText('cheap', { exact: true })).toBeVisible();

  // Details are hidden until requested.
  await expect(morningCard.locator('dl')).toHaveCount(0);
  await morningCard.getByRole('button', { name: 'Details', exact: true }).click();
  const morningDetails = morningCard.locator('dl');
  await expect(morningDetails).toBeVisible();
  await expect(
    morningDetails.getByText('At 09:30, Monday through Friday (America/Los_Angeles)', {
      exact: true,
    })
  ).toBeVisible();
  await expect(morningDetails.getByText('30 16 * * 1-5 (UTC)', { exact: true })).toBeVisible();
  await expect(morningDetails.locator('time[datetime="2026-09-16T12:00:00.000Z"]')).toHaveText(
    'Sep 16, 2026, 5:00:00 AM PDT'
  );
  const creator = morningDetails.getByRole('link', { name: '@Alice', exact: true });
  await expect(creator).toHaveAttribute('title', '@alice:example.org');

  // Copy ID provides feedback (or opens details if clipboard is unavailable).
  await morningCard.getByRole('button', { name: 'Copy ID', exact: true }).click();

  // Switch back to All and inspect a one-time task's details and prompt clamp.
  await filterGroup.getByRole('button', { name: /^All/ }).click();
  await expect(dialog.getByRole('article')).toHaveCount(3);
  const futureCard = dialog.getByRole('article').filter({ hasText: 'Project review' });
  await futureCard.getByRole('button', { name: /Project review/ }).click();
  await expect(futureCard.getByText('Recent messages: 12', { exact: true })).toBeVisible();
  await expect(
    futureCard.getByRole('button', { name: 'Show full prompt', exact: true })
  ).toBeVisible();
  await futureCard.getByRole('button', { name: 'Details', exact: true }).click();
  const futureDetails = futureCard.locator('dl');
  await expect(futureDetails.locator('time[datetime="2099-01-01T12:00:00.000Z"]')).toHaveText(
    'Jan 1, 2099, 4:00:00 AM PST'
  );
  await expect(
    futureDetails.getByText('From agent, room, or thread settings', { exact: true })
  ).toBeVisible();

  // Open thread closes the dialog and triggers navigation.
  const morningRow = dialog.getByRole('article').filter({ hasText: 'Morning inbox' });
  await morningRow.getByRole('button', { name: /Morning inbox/ }).click();
  await morningRow.getByRole('button', { name: 'Open thread', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Opened $inbox', { exact: true })).toBeVisible();

  // Live state updates remove cancelled tasks while keeping focus tidy.
  await trigger.click();
  await page.evaluate(() => window.dispatchEvent(new Event('cancel-schedule')));
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Scheduled tasks (2)', exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Scheduled tasks (2)', exact: true })
  ).toBeFocused();
});

test('schedule details wrap on phones in light, dark, and RTL themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const theme of ['?stress', '?dark&stress', '?rtl&stress']) {
    await page.goto(`/e2e/fixtures/room-schedules.html${theme}`);
    await page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (theme.includes('rtl'))
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
      });
    await expect(dialog).toBeVisible();
    // Expand the stress-heavy recurring card and its Details drawer to verify wrapping everywhere.
    const stressCard = dialog.getByRole('article').filter({ hasText: 'Morning inbox' });
    await stressCard.getByRole('button', { name: /Morning inbox/ }).click();
    await stressCard.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(stressCard.locator('dl')).toBeVisible();

    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    for (const card of await dialog.getByRole('article').all()) {
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});
