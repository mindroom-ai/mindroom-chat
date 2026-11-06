import { expect, type Page, type Route } from '@playwright/test';

/**
 * Holds every PUT to a URL whose path contains `pathPart` from the pages until each page has sent
 * one, then lets them all through together. Two people who act at the same moment then both read
 * what they read before either write lands, every run. Later writes pass at once.
 *
 * Playwright's WebKit does not route what a service worker fetches: give WebKit contexts
 * `serviceWorkers: 'block'`.
 */
export const holdFirstWrites = async (pages: Page[], pathPart: string) => {
  const held: Route[] = [];
  let released = false;
  const matches = (url: URL) => url.pathname.includes(pathPart);
  const handler = async (route: Route) => {
    if (released || route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    held.push(route);
  };
  await Promise.all(pages.map((page) => page.route(matches, handler)));
  return {
    release: async () => {
      await expect
        .poll(() => held.length, { message: 'each page sent its write', timeout: 20_000 })
        .toBe(pages.length);
      released = true;
      await Promise.all(held.map((route) => route.continue()));
    },
  };
};
