import { test } from '@playwright/test';

const HOMESERVER = 'https://mindroom.lab.mindroom.chat';
const ROOM_ID = '!TFs182DGokWnICCUm6:mindroom.lab.mindroom.chat';
const PREFIX = process.env.SHOT_PREFIX || 'before';

test('narrow toolbar', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'settings',
      JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', messageLayout: 0 })
    )
  );
  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}/`);
  await page.waitForSelector('[name="usernameInput"]', { timeout: 30000 });
  await page.fill('[name="usernameInput"]', 'e2e-test-bot');
  await page.fill('[name="passwordInput"]', 'e2e-test-pw-2026');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home\/?$/, { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.goto(`/home/${encodeURIComponent(ROOM_ID)}/`);
  await page.waitForTimeout(6000);
  for (const width of [900, 700, 560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `ui-audit/${PREFIX}-toolbar-${width}.png` });
  }
});
