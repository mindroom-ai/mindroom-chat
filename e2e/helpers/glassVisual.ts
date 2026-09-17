import { expect, type Locator, type Page } from '@playwright/test';

export const expectClearStrip = async (strip: Locator) => {
  await expect(strip).toHaveText('');
  await expect
    .poll(() =>
      strip.evaluate((element) =>
        [element, ...element.querySelectorAll('*')].flatMap((node) => {
          const css = getComputedStyle(node);
          const borders = [
            css.borderTopWidth,
            css.borderRightWidth,
            css.borderBottomWidth,
            css.borderLeftWidth,
          ];
          const clear =
            css.backgroundColor === 'rgba(0, 0, 0, 0)' &&
            css.backgroundImage === 'none' &&
            css.backdropFilter === 'none' &&
            css.boxShadow === 'none' &&
            borders.every((width) => width === '0px');
          return clear
            ? []
            : [
                {
                  tag: node.tagName,
                  className: node.className,
                  background: css.backgroundColor,
                  image: css.backgroundImage,
                  blur: css.backdropFilter,
                  shadow: css.boxShadow,
                  borders,
                },
              ];
        })
      )
    )
    .toEqual([]);
};

export type Rgba = [number, number, number, number];

const composite = (foreground: Rgba, background: Rgba): Rgba => {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
};

const luminance = ([red, green, blue]: Rgba) => {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

export const contrastRatio = (foreground: Rgba, background: Rgba) => {
  const foregroundLuminance = luminance(composite(foreground, background));
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

export const pixelDifference = (first: Rgba, second: Rgba) =>
  first.slice(0, 3).reduce((total, channel, index) => total + Math.abs(channel - second[index]), 0);

export const sampleScreenshot = async (
  page: Page,
  points: Array<{ x: number; y: number }>
): Promise<Rgba[]> => {
  const screenshot = await page.screenshot({ fullPage: true, scale: 'css' });
  return page.evaluate(
    async ({ source, samplePoints }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas context unavailable');
      context.drawImage(image, 0, 0);
      return samplePoints.map(({ x, y }) => {
        const pixel = context.getImageData(
          Math.min(canvas.width - 1, Math.max(0, Math.floor(x))),
          Math.min(canvas.height - 1, Math.max(0, Math.floor(y))),
          1,
          1
        ).data;
        return [pixel[0], pixel[1], pixel[2], pixel[3] / 255] as Rgba;
      });
    },
    {
      source: `data:image/png;base64,${screenshot.toString('base64')}`,
      samplePoints: points,
    }
  );
};

// Catch a header outside its scrolling viewport, an opaque material, or raised
// edges reappearing when switching between navigation sections.
export async function expectFloatingNavHeader(header: Locator) {
  await expect(header).toBeVisible();
  const scroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
  await expect(scroll).toHaveCount(1);
  const geometry = () =>
    header.evaluate((element) => {
      const viewport = element.closest('[data-y-scrollbar-width]')!;
      const css = getComputedStyle(element);
      return {
        offset: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
        border: [
          css.borderTopWidth,
          css.borderRightWidth,
          css.borderBottomWidth,
          css.borderLeftWidth,
        ],
        shadow: css.boxShadow,
        highlight: css.backgroundImage,
        filter: css.backdropFilter,
        alpha: Number(css.backgroundColor.split('/')[1]?.replace(')', '').trim()),
      };
    });
  await expect.poll(async () => (await geometry()).offset).toBeCloseTo(0, 0);
  const material = await geometry();
  expect(material.border).toEqual(['0px', '0px', '0px', '0px']);
  expect(material.shadow).toBe('none');
  expect(material.highlight).toBe('none');
  expect(material.filter).toContain('blur(');
  expect(material.filter).not.toContain('url(');
  expect(material.alpha).toBeGreaterThan(0);
  expect(material.alpha).toBeLessThan(1);
  return scroll;
}
