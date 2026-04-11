import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasCredentials = !!process.env.E2E_USERNAME;
const FIXTURE_ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#cinny-e2e-fixture:mindroom.lab.mindroom.chat';
const FIXTURE_ROOM_ID = process.env.E2E_FIXTURE_ROOM_ID;
const HIDDEN_THREAD_RELATION_ROOT_MARKER = '[cinny-e2e] Hidden relation thread root';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Navigate directly to the seeded fixture room.
 */
async function navigateToFixtureRoom(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`/home/${encodeURIComponent(FIXTURE_ROOM_ID ?? FIXTURE_ROOM_ALIAS)}`);
  await waitForLoggedInShell(page);
  return true;
}

test.describe('live threads', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('thread overview panel visible in fixture room', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const found = await navigateToFixtureRoom(page);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    // Look for thread overview panel or thread indicators in the room
    const threadOverview = page.locator('[data-room-thread-overview="true"]');
    const threadIndicators = page.locator('[class*="thread"], [class*="Thread"]');

    // Either the overview panel or thread indicators should be visible
    const hasThreadUI =
      (await threadOverview.count()) > 0 || (await threadIndicators.count()) > 0;

    expect(hasThreadUI).toBe(true);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-overview');
  });

  test('thread counts are numeric (not loading placeholders)', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const found = await navigateToFixtureRoom(page);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    // Wait for thread counts to settle from "-" to numeric values
    // Thread count indicators might be in thread overview or inline thread chips
    const threadCounts = page.locator(
      '[data-room-thread-overview="true"] [class*="count"], [class*="ThreadCount"], [class*="thread-count"]'
    );

    // Thread count elements must be present in the fixture room
    await expect(threadCounts.first()).toBeVisible({
      timeout: 30_000,
    });

    // Poll until at least one count is numeric (not "-")
    await expect
      .poll(
        async () => {
          const texts = await threadCounts.allTextContents();
          return texts.some((t) => /^\d/.test(t.trim()));
        },
        { timeout: 30_000, message: 'Thread counts should settle to numeric values' }
      )
      .toBe(true);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-counts');
  });

  test('thread navigation works (click into thread, messages render)', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const found = await navigateToFixtureRoom(page);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    // Find a clickable thread indicator (thread chip, "N replies" link, or thread overview item)
    const threadEntry = page.locator(
      '[class*="thread-indicator"], [class*="ThreadIndicator"], [data-room-thread-overview="true"] a, [class*="ThreadItem"]'
    );

    // Thread entries must be present in the fixture room
    await expect(threadEntry.first()).toBeVisible({
      timeout: 30_000,
    });

    await threadEntry.first().click();

    // After clicking, verify thread-specific content renders (not just room-level messages)
    const threadPanel = page.locator(
      '[class*="ThreadView"], [class*="thread-panel"], [class*="ThreadPanel"]'
    );
    // Look for known fixture thread reply text to prove we're inside the thread
    const threadReplyContent = page.getByText('Thread reply 1');

    await expect
      .poll(
        async () => {
          const panelVisible = (await threadPanel.count()) > 0;
          const replyVisible = (await threadReplyContent.count()) > 0;
          return panelVisible || replyVisible;
        },
        { timeout: 30_000, message: 'Thread-specific content should render after clicking thread entry' }
      )
      .toBe(true);

    // Verify no "Failed to load this thread" error
    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-navigation');
  });

  test('hidden threaded metadata relations do not inflate visible reply counts', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const found = await navigateToFixtureRoom(page);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    const hiddenRelationThreadButton = page.getByRole('button', {
      name: new RegExp(`${escapeRegex(HIDDEN_THREAD_RELATION_ROOT_MARKER)}[\\s\\S]*0 replies`, 'i'),
    });
    await expect(hiddenRelationThreadButton).toBeVisible({ timeout: 30_000 });

    await hiddenRelationThreadButton.click();
    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(HIDDEN_THREAD_RELATION_ROOT_MARKER)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('com.mindroom.thread.tag')).toHaveCount(0);
    await expect(page.getByText('Thread reply 1')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'hidden-threaded-metadata-count');
  });

  test('summary card renders with expected content', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const found = await navigateToFixtureRoom(page);
    test.skip(!found, `Fixture room "${FIXTURE_ROOM_ALIAS}" not found — run seed-fixture-room.mjs`);

    // Look for AI thread summary card
    const summaryCard = page.locator('[aria-label="AI thread summary"]');

    if ((await summaryCard.count()) === 0) {
      // Summary card might be further down in the timeline — scroll to look for it
      const timeline = page.locator('[class*="PageContent"], [class*="RoomTimeline"]');
      if ((await timeline.count()) > 0) {
        await timeline.first().evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(2_000);
      }
    }

    // Summary card must be present in the fixture room (failure = rendering bug, not a skip)
    await expect(summaryCard.first()).toBeVisible({ timeout: 10_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'summary-card');
  });
});
