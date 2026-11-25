import { expect, test } from '@playwright/test';

// Fixture check for workflow run cards (running, waiting, done, interrupted), question cards
// (options, free-text, answered), and the workflow jobs-bar row, including keyboard reachability.

test.describe('workflow run cards fixture', () => {
  for (const [label, viewport] of [
    ['wide', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test(`renders cards and keyboard-reachable controls at ${label} width`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto('/e2e/fixtures/workflow-run.html?lang=en');

      await expect(page.getByText('Audit the sample module').first()).toBeVisible();
      await expect(page.getByText('Waiting for you')).toBeVisible();
      await expect(page.getByText('Stopped at the cost limit ($2.00 of $2.00).')).toBeVisible();
      await expect(page.getByText('2 failed')).toBeVisible();
      await expect(page.getByText('Answered: Yes')).toBeVisible();

      const stopButton = page.getByRole('button', { name: 'Stop' }).first();
      await stopButton.focus();
      await expect(stopButton).toBeFocused();

      const optionButton = page.getByRole('button', { name: 'Yes, deploy' });
      await optionButton.focus();
      await expect(optionButton).toBeFocused();

      await page.screenshot({
        path: testInfo.outputPath(`workflow-run-cards-${label}.png`),
        fullPage: true,
      });
    });
  }
});
