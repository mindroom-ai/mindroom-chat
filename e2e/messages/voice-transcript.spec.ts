import { expect, test } from '@playwright/test';

test('a voice message shows its transcript or a status while it transcribes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: Buffer.alloc(44) })
  );
  await page.goto('/e2e/fixtures/voice-transcript.html');
  const done = page.getByRole('region', { name: 'Transcribed voice message', exact: true });
  await expect(done.getByText('Remind me to water the ferns', { exact: false })).toBeVisible();
  await expect(done.getByText('Transcribed by Helper', { exact: true })).toBeVisible();
  await expect(done.getByText('🎤', { exact: false })).toHaveCount(0);

  const pending = page.getByRole('region', { name: 'Voice message being transcribed' });
  const status = pending.getByRole('status', { name: 'Transcribing…' });
  await expect(status).toBeVisible();
  await expect(status.locator('span[aria-hidden="true"] > span:empty')).toHaveCount(2);
  await expect(pending.getByText('Router agent', { exact: false })).toHaveCount(0);

  const historical = page.getByRole('region', { name: 'Historical router transcript' });
  await expect(historical.getByText('Add oat milk to the list.')).toBeVisible();
  await expect(historical.getByText('Transcribed by Router', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
