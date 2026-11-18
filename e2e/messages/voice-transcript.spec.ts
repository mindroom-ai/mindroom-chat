import { expect, test } from '@playwright/test';

test("a voice message shows the router's transcript, or a status while it transcribes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: Buffer.alloc(44) })
  );
  await page.goto('/e2e/fixtures/voice-transcript.html');
  const done = page.getByRole('region', { name: 'Transcribed voice message', exact: true });
  await expect(done.getByText('Remind me to water the ferns', { exact: false })).toBeVisible();
  await expect(done.getByText('Transcribed by Router', { exact: true })).toBeVisible();
  await expect(done.getByText('🎤', { exact: false })).toHaveCount(0);

  const pending = page.getByRole('region', { name: 'Voice message being transcribed' });
  await expect(pending.getByRole('status', { name: 'Transcribing…' })).toBeVisible();
  await expect(pending.getByText('Router agent', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});
