import { expect, type Page } from '@playwright/test';

/** An element's corner radii in px: top-left, top-right, bottom-right, bottom-left. */
export const cornersOf = (element: Element): number[] => {
  const style = getComputedStyle(element);
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((radius) => parseFloat(radius));
};

/**
 * The corner radius of the page's card, in px, at a size where the page floats as a card beside
 * the rail (1280 by 800): the radius a phone's sheets round their free corner with.
 */
export const pageCardRadius = async (page: Page): Promise<number> => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#phone-nav-menu-button')).toHaveCount(0);
  const radius = await page.evaluate(() => {
    const main = document.querySelector('main[data-page-main]');
    const surface = Array.from(main?.querySelectorAll('*') ?? []).find(
      (element) =>
        element.getBoundingClientRect().width > 400 &&
        parseFloat(getComputedStyle(element).borderBottomRightRadius) > 0
    );
    return surface ? parseFloat(getComputedStyle(surface).borderBottomRightRadius) : 0;
  });
  expect(radius, 'the page floats as a rounded card on a wide screen').toBeGreaterThan(0);
  return radius;
};
