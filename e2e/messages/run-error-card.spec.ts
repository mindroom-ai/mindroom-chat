import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Verifies Variant A RunErrorCard (warning and danger tones, collapsible monospace technical
// details, deduplicated fallback text, quiet service-restart seam, and one-click Continue folding
// to a 1-line receipt) across desktop/phone viewports and dark/light themes using placeholder data.
// Set E2E_SCREENSHOT_DIR=<directory> to save desktop and 390 px phone shots, dark and light.
const PASSWORD = 'run-error-card-spec-password';
const RUN = Date.now().toString(36);
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const SHOTS = [
  ['desktop-dark', 'dark-theme', DESKTOP],
  ['phone-dark', 'dark-theme', PHONE],
  ['desktop-light', 'light-theme', DESKTOP],
  ['phone-light', 'light-theme', PHONE],
] as const;

const PROGRESS = 'Finished inspecting the sample build configuration.';
const STALLED_SUMMARY = 'ExampleRouter sent no data for 5 min (retried once automatically).';
const CONTEXT_SUMMARY = 'This thread exceeded the example model context limit.';

const applyTheme = async (page: Page, themeId: string) => {
  await page.evaluate((theme) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: theme })
    );
  }, themeId);
  await page.reload();
};

const expectFitsViewport = async (page: Page, locator: Locator) => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('renders RunErrorCard, collapses restart seams, toggles technical details, and folds on Continue', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);

  const username = `rec_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'sampleagent');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Run error card fixture',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);

  const makeThread = async (rootBody: string) => {
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: rootBody,
    });
    const inThread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    return {
      url: `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`,
      reply: (content: Record<string, unknown>) =>
        sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
          ...content,
          'm.relates_to': inThread,
        }),
    };
  };

  // Thread 1: warning card with prior streamed text, 2x service restarts, and fallback error text.
  const stalledThread = await makeThread('Please check the sample build configuration.');
  await stalledThread.reply({
    msgtype: 'm.text',
    body:
      `${PROGRESS}\n\n` +
      '**[Response interrupted by service restart]**\n\n' +
      '**[Response interrupted by service restart]**\n\n' +
      `[mindroom_sampleagent] ⚠️ ${STALLED_SUMMARY}`,
    format: 'org.matrix.custom.html',
    formatted_body:
      `<p>${PROGRESS}</p>` +
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      `<p>[mindroom_sampleagent] ⚠️ ${STALLED_SUMMARY}</p>`,
    'io.mindroom.stream_status': 'error',
    'io.mindroom.ai_run': {
      version: 1,
      status: 'error',
      model: {
        config: 'sample_fast',
        display_name: 'Sample Model',
        id: 'example/sample-model-v1',
        provider: 'examplerouter',
      },
      error: {
        kind: 'stream_stalled',
        title: 'Sample Model stopped responding',
        summary: STALLED_SUMMARY,
        detail: 'Stream timed out after 300s waiting for next chunk',
        code: 'stream_stalled',
        status_code: 504,
        provider: 'ExampleRouter',
        retryable: true,
        action: 'continue',
      },
    },
  });

  // Thread 2: danger card (context window full) with Compact action.
  const contextThread = await makeThread('Summarize the whole archive.');
  await contextThread.reply({
    msgtype: 'm.text',
    body: `⚠️ ${CONTEXT_SUMMARY}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>⚠️ ${CONTEXT_SUMMARY}</p>`,
    'io.mindroom.stream_status': 'error',
    'io.mindroom.ai_run': {
      version: 1,
      status: 'error',
      model: {
        config: 'sample_fast',
        display_name: 'Sample Model',
        id: 'example/sample-model-v1',
        provider: 'examplerouter',
      },
      error: {
        kind: 'context_window',
        title: 'Context window full',
        summary: CONTEXT_SUMMARY,
        code: 'context_window_exceeded',
        status_code: 400,
        provider: 'ExampleRouter',
        retryable: false,
        action: 'compact',
      },
    },
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username,
    password: PASSWORD,
  });

  // 1. Inspect the danger card in Thread 2.
  await page.goto(contextThread.url);
  const dangerCard = page.locator('[data-run-error-card="open"][data-tone="danger"]');
  await expect(dangerCard).toBeVisible({ timeout: 60_000 });
  await expect(dangerCard).toContainText('Context window full');
  await expect(dangerCard).toContainText('Context limit');
  await expect(dangerCard.getByRole('button', { name: 'Compact' })).toBeVisible();
  if (SCREENSHOT) {
    await page.screenshot({ path: `${SCREENSHOT}/danger-desktop-dark.png` });
  }

  // 2. Inspect the warning card + collapsed restart seam in Thread 1 across themes & viewports.
  await page.goto(stalledThread.url);
  const warnCard = page.locator('[data-run-error-card="open"][data-tone="warning"]');
  await expect(warnCard).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(PROGRESS)).toBeVisible();
  const restartSeam = page.locator('[data-restart-seam="2"]');
  await expect(restartSeam).toBeVisible();
  await expect(restartSeam).toHaveText('Service restarted (2×) · context preserved');
  // Fallback body paragraph is deduplicated.
  await expect(page.getByText('[mindroom_sampleagent]')).toHaveCount(0);

  // Verify dark/light and desktop/phone layout fit cleanly without overflow.
  for (const [shotName, themeId, viewport] of SHOTS) {
    await page.setViewportSize(viewport);
    await applyTheme(page, themeId);
    await expect(warnCard).toBeVisible({ timeout: 60_000 });
    await expectFitsViewport(page, warnCard);
    const detailsBtn = warnCard.getByRole('button', { name: 'Technical details' });
    await detailsBtn.click();
    await expect(detailsBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(warnCard).toContainText('example/sample-model-v1 (Sample Model)');
    await expect(warnCard).toContainText('504 · stream_stalled');
    await expectFitsViewport(page, warnCard);
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/${shotName}-expanded.png` });
    }
    await detailsBtn.click();
    await expect(detailsBtn).toHaveAttribute('aria-expanded', 'false');
  }

  // 3. Click Continue and verify folded 1-line receipt + threaded mention sent.
  await page.setViewportSize(DESKTOP);
  const continueBtn = warnCard.getByRole('button', { name: 'Continue' });
  await continueBtn.click();

  const receipt = page.locator('[data-run-error-card="resumed"]');
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(receipt).toContainText('Resumed');
  await expect(receipt).toContainText('Sample Model stopped responding');
  await expect(page.locator('[data-message-item]').filter({ hasText: 'Continue.' })).toBeVisible({
    timeout: 30_000,
  });

  if (SCREENSHOT) {
    await page.screenshot({ path: `${SCREENSHOT}/desktop-light-resumed.png` });
  }

  // Expanding the folded receipt reveals the original summary and technical details.
  const receiptToggle = receipt.getByRole('button');
  await receiptToggle.click();
  await expect(receiptToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(receipt).toContainText(STALLED_SUMMARY);
  await expect(receipt).toContainText('504 · stream_stalled');
});
