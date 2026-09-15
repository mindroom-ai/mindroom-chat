import { expect, test, type Page } from '@playwright/test';

// Twelve seconds of silent PCM keeps the real audio component self-contained.
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

const expectOpaqueFallback = async (page: Page) => {
  for (const [name, surface] of [
    ['menu', page.getByTestId('glass-menu')],
    ['modal', page.getByTestId('glass-modal')],
    ['header', page.getByTestId('glass-header')],
    ['editor', page.getByTestId('editor-host').locator(':scope > div')],
    ['audio', page.getByTestId('audio-host').locator(':scope > div > div').last()],
  ]) {
    await expect(surface).toHaveCSS('backdrop-filter', 'none');
    expect(await surface.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(
      'none'
    );
    expect(
      await surface.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas context unavailable');
        const alpha = (target: Element) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = getComputedStyle(target).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3] / 255;
        };
        let renderedAlpha = alpha(element);
        let ancestor = element.parentElement;
        while (renderedAlpha < 1 && ancestor) {
          const ancestorAlpha = alpha(ancestor);
          renderedAlpha += ancestorAlpha * (1 - renderedAlpha);
          ancestor = ancestor.parentElement;
        }
        return renderedAlpha;
      }),
      `${name} rendered background alpha`
    ).toBe(1);
  }
};

for (const theme of ['light', 'silver', 'dark', 'midnight', 'butter']) {
  test(`shared materials retain text contrast in ${theme}`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);

    const menu = page.getByTestId('glass-menu');
    await expect(menu).not.toHaveCSS('backdrop-filter', 'none');
    expect(await menu.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(
      'none'
    );

    const header = page.getByTestId('glass-header');
    const contrast = await header.evaluate((element) => {
      type Rgba = [number, number, number, number];
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas context unavailable');
      const parse = (value: string): Rgba => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue, alpha / 255];
      };
      const composite = (foreground: Rgba, background: Rgba): Rgba => {
        const alpha = foreground[3] + background[3] * (1 - foreground[3]);
        if (alpha === 0) return [0, 0, 0, 0];
        return [
          (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) /
            alpha,
          (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) /
            alpha,
          (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) /
            alpha,
          alpha,
        ];
      };
      let background = parse(getComputedStyle(element).backgroundColor);
      let ancestor = element.parentElement;
      while (background[3] < 1 && ancestor) {
        background = composite(background, parse(getComputedStyle(ancestor).backgroundColor));
        ancestor = ancestor.parentElement;
      }
      const foreground = composite(parse(getComputedStyle(element).color), background);
      const luminance = ([red, green, blue]: Rgba) => {
        const linear = [red, green, blue].map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('accessibility preferences use opaque materials without blur', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=midnight');
  await expectOpaqueFallback(page);

  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-contrast', value: 'more' }],
  });
  await expectOpaqueFallback(page);

  await page.emulateMedia({ forcedColors: 'active' });
  await expectOpaqueFallback(page);
});

test('real controls keep focus, editing, playback, and narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=silver');

  const workspace = page.getByRole('button', { name: 'Open workspace' });
  await page.keyboard.press('Tab');
  await expect(workspace).toBeFocused();
  expect(await workspace.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    'none'
  );

  const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
  await editor.fill('A readable message');
  await expect(editor).toHaveText('A readable message');

  const player = page.getByRole('region', { name: 'Audio attachment' });
  await player.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause audio', exact: true })).toBeVisible();

  for (const surface of [page.getByTestId('glass-modal'), page.getByTestId('glass-menu'), player]) {
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error('Glass surface has no bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
});
