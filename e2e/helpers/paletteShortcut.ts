import type { Page } from '@playwright/test';

/**
 * Opens the command palette with the keys the app names for it: ⌘K where the browser says it runs
 * on a Mac (not an iPhone or iPad), else Ctrl+K, as `isMacOS` in src/app/lib/user-agent.ts
 * decides. Playwright's ControlOrMeta asks the host instead, and Linux WebKit says Macintosh in
 * its user agent, so there it pressed Ctrl+K where the app listens for ⌘K.
 */
export const pressPaletteShortcut = async (page: Page): Promise<void> => {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || '';
    const ios =
      /iPhone|iPad|iPod/i.test(nav.userAgent) ||
      /iPhone|iPad|iPod/i.test(platform) ||
      (/Mac/i.test(platform) && (nav.maxTouchPoints ?? 0) > 1);
    return !ios && (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(nav.userAgent));
  });
  await page.keyboard.press(mac ? 'Meta+k' : 'Control+k');
};
