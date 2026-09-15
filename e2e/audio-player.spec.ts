import { expect, test } from '@playwright/test';

// Twelve seconds of silent PCM: exercises real browser media without external files.
const audio = Buffer.alloc(192044);
audio.write('RIFF', 0);
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(audio.length - 44, 40);

test.beforeEach(async ({ page }) => {
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: audio })
  );
});

test('shared audio controls play, scrub, change speed and expose downloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/e2e/fixtures/audio-player.html');
  for (const name of ['Audio attachment', 'Voice message']) {
    const player = page.getByRole('region', { name, exact: true });
    const label = name === 'Voice message' ? 'voice message' : 'audio';
    await expect(player.getByRole('button', { name: /Playback speed/ })).toBeVisible();
    await player.getByRole('button', { name: `Play ${label}`, exact: true }).click();
    await expect(player.getByRole('button', { name: `Pause ${label}`, exact: true })).toBeVisible();
    await player.getByRole('button', { name: `Pause ${label}`, exact: true }).click();

    const slider = player.getByRole('slider', { name: `Seek ${label}` });
    const bounds = await slider.boundingBox();
    if (!bounds) throw new Error('Seek slider has no bounds');
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
      .toBeGreaterThan(8);
    await slider.press('Home');
    await expect(slider).toHaveValue('0');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('5');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 0:12');

    await player.getByRole('button', { name: /Playback speed/ }).click();
    await expect
      .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate))
      .toBeGreaterThan(1);
    await player.getByRole('button', { name: 'More audio options' }).click();
    await expect(page.getByRole('button', { name: /^Download / })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  test(`audio cards fit narrow bubbles in ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/e2e/fixtures/audio-player.html?theme=${theme}`);
    await expect(
      page.getByText('Interview with the design team.wav', { exact: true })
    ).toBeVisible();
    for (const region of await page.getByRole('region').all()) {
      const bounds = await region.boundingBox();
      if (!bounds) throw new Error('Audio card has no bounds');
      expect(bounds.width).toBeGreaterThan(240);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      for (const control of await region.locator('button, input[type="range"]').all()) {
        const controlBounds = await control.boundingBox();
        if (!controlBounds) throw new Error('Audio control has no bounds');
        expect(controlBounds.x).toBeGreaterThanOrEqual(bounds.x);
        expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1
        );
      }
    }
    await page
      .locator('#root > div')
      .screenshot({ path: testInfo.outputPath(`audio-${theme}.png`) });
  });
}

test('audio controls fit a narrow panel on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/e2e/fixtures/audio-player.html');
  await expect(page.getByRole('button', { name: 'Play audio', exact: true })).toBeVisible();
  await page.getByRole('region').evaluateAll((regions) => {
    regions.forEach((region) => {
      region.style.width = '220px';
    });
  });
  for (const region of await page.getByRole('region').all()) {
    const bounds = await region.boundingBox();
    if (!bounds) throw new Error('Audio card has no bounds');
    expect(bounds.width).toBe(220);
    for (const control of await region.locator('button, input[type="range"]').all()) {
      const controlBounds = await control.boundingBox();
      if (!controlBounds) throw new Error('Audio control has no bounds');
      expect(controlBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1
      );
    }
  }
});
