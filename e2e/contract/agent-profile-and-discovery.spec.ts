import { readFileSync } from 'node:fs';
import {
  clientSessionToken,
  expect,
  messageRow,
  openLobby,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// Real-backend contract specs under production discovery (`computers: { apiUrl: "" }`, default
// `clientApiUrl: false`, zero HTTP mocks): agent profile card discovery, real dictation probing
// and transcription, and encrypted provider usage limits RPC.
test.use({ agentStackArgs: ['--client-sessions', '--transcription', 'stub'] });
test.describe.configure({ timeout: 300_000 });

const COMPUTER_SERVICE_STORAGE_KEY = 'mindroomComputerService.v1';

test('discovers Helper profile card automatically with empty computers.apiUrl', async ({
  page,
  stack,
}) => {
  const configResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/config.json') && response.status() === 200,
    { timeout: 90_000 }
  );
  await openLobby(page, stack);
  const configBody = (await (await configResponsePromise).json()) as {
    mindroom?: { computers?: { apiUrl?: string } };
  };
  expect(configBody.mindroom?.computers?.apiUrl ?? '').toBe('');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), COMPUTER_SERVICE_STORAGE_KEY)
  ).toBeNull();

  const word = uniqueWord('profile');
  const rootId = await startThread(stack, word);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes(word));

  await showThread(page, stack, rootId);
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toBeVisible({ timeout: 60_000 });
  await replyRow.locator(`[data-user-id="${stack.agents.helper}"]`).first().click();

  const card = page.getByRole('dialog', { name: 'Helper', exact: true });
  await expect(card.getByText('Stub Fast', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    card.getByText('Test agent driven by a stub model', { exact: true })
  ).toBeVisible();
  await expect(card.getByText('Configured tools', { exact: true })).toBeVisible();
  await expect(card.getByText(/Shell Commands/)).toBeVisible();

  await card.getByRole('button', { name: /View all/ }).click();
  await card.getByLabel('Filter tools').fill('shell');
  await expect(card.getByText('Shell Commands', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('probes real dictation status via automatic discovery and transcribes a WAV segment', async ({
  page,
  stack,
}) => {
  const statusResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().startsWith(`${stack.apiUrl}/api/dictation/v1/status`),
    { timeout: 90_000 }
  );
  await openLobby(page, stack);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), COMPUTER_SERVICE_STORAGE_KEY)
  ).toBeNull();

  const statusResponse = await statusResponsePromise;
  expect(statusResponse.status()).toBe(200);
  const status = (await statusResponse.json()) as { enabled?: boolean };
  expect(status.enabled).toBe(true);
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible({ timeout: 30_000 });

  const token = await clientSessionToken(stack);
  const wav = readFileSync(new URL('../fixtures/agent-call-question.wav', import.meta.url));
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
  const transcribeResponse = await fetch(
    `${stack.apiUrl}/api/dictation/v1/transcribe?room_id=${encodeURIComponent(stack.rooms.lobby)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  expect(transcribeResponse.status).toBe(200);
  const transcribed = (await transcribeResponse.json()) as { text?: string };
  expect(transcribed.text).toMatch(/Stand-in transcript of/);
});

test('loads provider usage limits over encrypted RPC without errors', async ({ page, stack }) => {
  await openLobby(page, stack);
  await showPath(page, '/usage/');

  const usageView = page.getByTestId('usage-view');
  await expect(usageView).toBeVisible({ timeout: 60_000 });
  await expect(
    usageView.getByRole('heading', { name: 'Usage & Limits', exact: true })
  ).toBeVisible();

  const limitsTab = usageView.getByRole('tab', { name: 'Limits', exact: true });
  const tokensTab = usageView.getByRole('tab', { name: 'Tokens & Cost', exact: true });
  await expect(limitsTab).toBeVisible({ timeout: 90_000 });
  await expect(limitsTab).toHaveAttribute('aria-selected', 'true');
  await expect(tokensTab).toBeVisible();
  await expect(page.getByTestId('usage-unavailable')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);

  await tokensTab.click();
  await expect(tokensTab).toHaveAttribute('aria-selected', 'true');
  await expect(usageView.getByText('7-day total tokens', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('usage-unavailable')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
});
