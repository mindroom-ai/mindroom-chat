import { expect, test, type Locator, type Page } from '@playwright/test';
import { contrastRatio, pixelDifference, sampleScreenshot, type Rgba } from './helpers/glassVisual';

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

type VisualSample = {
  boundaryTestId: string;
  name: string;
  text: Locator;
};

type PreparedSample = VisualSample & {
  color: Rgba;
  point: { x: number; y: number };
  visibility: string;
};

const prepareSamples = async (samples: VisualSample[]): Promise<PreparedSample[]> => {
  const prepared: PreparedSample[] = [];
  for (const sample of samples) {
    await expect(sample.text, `${sample.name} text`).toBeVisible();
    const details = await sample.text.evaluate((element, boundaryTestId) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas context unavailable');
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      let effectiveOpacity = 1;
      let ancestor: Element | null = element;
      while (ancestor) {
        const opacity = Number.parseFloat(getComputedStyle(ancestor).opacity);
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        if ((ancestor as HTMLElement).dataset.testid === boundaryTestId) break;
        ancestor = ancestor.parentElement;
      }
      if (!ancestor) throw new Error(`Missing contrast boundary: ${boundaryTestId}`);
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = Array.from(range.getClientRects()).find(
        (candidate) => candidate.width > 0 && candidate.height > 0
      );
      const bounds = rect ?? element.getBoundingClientRect();
      const visibility = (element as HTMLElement).style.visibility;
      return {
        color: [pixel[0], pixel[1], pixel[2], (pixel[3] / 255) * effectiveOpacity] as Rgba,
        point: {
          x: bounds.left + bounds.width / 2 + window.scrollX,
          y: bounds.top + bounds.height / 2 + window.scrollY,
        },
        visibility,
      };
    }, sample.boundaryTestId);
    prepared.push({ ...sample, ...details });
  }
  await Promise.all(
    prepared.map(({ text }) =>
      text.evaluate((element) => {
        (element as HTMLElement).style.visibility = 'hidden';
      })
    )
  );
  return prepared;
};

const restoreSamples = async (samples: PreparedSample[]) => {
  await Promise.all(
    samples.map(({ text, visibility }) =>
      text.evaluate((element, previousVisibility) => {
        (element as HTMLElement).style.visibility = previousVisibility;
      }, visibility)
    )
  );
};

const renderedContrast = async (page: Page, samples: VisualSample[]) => {
  const prepared = await prepareSamples(samples);
  try {
    const backgrounds = await sampleScreenshot(
      page,
      prepared.map(({ point }) => point)
    );
    return prepared.map(({ name, color }, index) => ({
      name,
      ratio: contrastRatio(color, backgrounds[index]),
    }));
  } finally {
    await restoreSamples(prepared);
  }
};

const renderedBackgrounds = async (page: Page, samples: VisualSample[]) => {
  const prepared = await prepareSamples(samples);
  try {
    return await sampleScreenshot(
      page,
      prepared.map(({ point }) => point)
    );
  } finally {
    await restoreSamples(prepared);
  }
};

const expectRenderedContrast = async (
  page: Page,
  theme: string,
  backdrop: string,
  samples: VisualSample[]
) => {
  for (const { name, ratio } of await renderedContrast(page, samples)) {
    expect(ratio, `${theme} ${backdrop} ${name} rendered contrast`).toBeGreaterThanOrEqual(4.5);
  }
};

test.beforeEach(async ({ page }) => {
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: audio })
  );
});

const materialText = (page: Page): VisualSample[] => [
  { boundaryTestId: 'glass-menu', name: 'menu', text: page.getByTestId('menu-copy') },
  { boundaryTestId: 'glass-modal', name: 'modal', text: page.getByTestId('modal-copy') },
  { boundaryTestId: 'glass-header', name: 'header', text: page.getByTestId('header-copy') },
  {
    boundaryTestId: 'editor-host',
    name: 'editor',
    text: page.locator('[contenteditable="true"][data-editable-name="Message"] p'),
  },
  {
    boundaryTestId: 'audio-host',
    name: 'audio',
    text: page.getByTitle('0:00 / 0:12', { exact: true }),
  },
];

const expectOpaqueFallback = async (page: Page) => {
  const shadowProperty = await page.locator('main').getAttribute('data-glass-shadow-property');
  if (!shadowProperty) throw new Error('Glass shadow property unavailable');
  for (const [name, surface] of [
    ['menu', page.getByTestId('glass-menu')],
    ['modal', page.getByTestId('glass-modal')],
    ['header', page.getByTestId('glass-header')],
    ['editor', page.getByTestId('editor-host').locator(':scope > div')],
    ['audio', page.getByTestId('audio-host').locator(':scope > div > div').last()],
  ] as const) {
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
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      }),
      `${name} own background alpha`
    ).toBe(1);
    if (name === 'menu' || name === 'header') {
      expect(
        await surface.evaluate(
          (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
          shadowProperty
        ),
        `${name} glass shadow fallback`
      ).toContain('transparent');
    }
  }
};

for (const theme of ['light', 'silver', 'dark', 'midnight', 'butter']) {
  test(`shared materials retain rendered text contrast over every backdrop in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
    await editor.fill('A readable message');
    await expect(page.getByTestId('glass-menu')).not.toHaveCSS('backdrop-filter', 'none');

    const main = page.locator('main');
    const samples = materialText(page);
    for (const [backdrop, background] of [
      ['fixture', undefined],
      ['black', 'rgb(0 0 0)'],
      ['white', 'rgb(255 255 255)'],
    ] as const) {
      if (background) {
        await main.evaluate((element, value) => {
          element.style.background = value;
        }, background);
      }
      await expectRenderedContrast(page, theme, backdrop, samples);
      if (!background) continue;
      for (const sample of samples.filter(({ name }) => ['menu', 'modal'].includes(name))) {
        await sample.text.hover();
        await expect
          .poll(() =>
            page
              .getByTestId(sample.boundaryTestId)
              .evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
          )
          .not.toBe('');
        await expectRenderedContrast(page, theme, `${backdrop} pointer highlight`, [sample]);
      }
    }
  });
}

test('shared materials reveal changes in the backdrop', async ({ page }) => {
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=light');
  const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
  await editor.fill('A readable message');
  const samples = materialText(page).filter(({ name }) =>
    ['menu', 'modal', 'editor'].includes(name)
  );
  const main = page.locator('main');
  const editorHost = page.getByTestId('editor-host');

  await main.evaluate((element) => {
    element.style.background = 'rgb(20 42 82)';
  });
  await editorHost.evaluate((element) => {
    element.style.background = 'rgb(20 42 82)';
  });
  const darkBackdrop = await renderedBackgrounds(page, samples);
  const repeatedDarkBackdrop = await renderedBackgrounds(page, samples);
  await main.evaluate((element) => {
    element.style.background = 'rgb(236 216 178)';
  });
  await editorHost.evaluate((element) => {
    element.style.background = 'rgb(236 216 178)';
  });
  const lightBackdrop = await renderedBackgrounds(page, samples);

  samples.forEach(({ name }, index) => {
    const screenshotDrift = pixelDifference(darkBackdrop[index], repeatedDarkBackdrop[index]);
    const backdropResponse = pixelDifference(repeatedDarkBackdrop[index], lightBackdrop[index]);
    expect(backdropResponse, `${name} backdrop response`).toBeGreaterThanOrEqual(
      screenshotDrift + 12
    );
  });
});

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
