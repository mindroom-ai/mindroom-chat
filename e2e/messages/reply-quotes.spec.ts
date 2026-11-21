import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Reply quotes in a thread, with the relations the MindRoom backend sends. A voice message gets a
// transcript and answer from the same agent. They are both genuine replies to the voice
// message, but the transcript folds into it, so the immediately following answer needs no
// quote. A reply to the voice message after an unrelated message still quotes it.
// Set REPLY_QUOTES_SCREENSHOT to a path to save a picture of the thread.

const PASSWORD = 'reply-quotes-password';
const VOICE_CLIP = new URL('../fixtures/agent-call-question.wav', import.meta.url);

const register = (username: string) =>
  matrixFetch<{ access_token: string; user_id: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });

const uploadVoiceClip = async (accessToken: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=voice.wav`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'audio/wav' },
    body: await readFile(VOICE_CLIP),
  });
  expect(response.ok, `upload status ${response.status}`).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

/** A thread message as the backend's `build_thread_relation` builds it. */
const inThread = (rootId: string, replyToId: string, isFallingBack: boolean) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: isFallingBack,
  'm.in_reply_to': { event_id: replyToId },
});

/** Signs in through the login page; a loaded machine can take a minute to show the shell. */
const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
};

test('an agent answer to a voice message quotes it only when other messages sit between', async ({
  page,
}) => {
  test.setTimeout(300_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const username = `quotes_${Date.now().toString(36)}`;
  const { access_token: token, user_id: readerId } = await register(username);
  const owner = await registerAgentAccount(HOMESERVER, 'router');
  const helper = await registerAgentAccount(HOMESERVER, 'helper');
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(helper.userId)}/displayname`, {
    method: 'PUT',
    accessToken: helper.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
    name: 'Reply Quotes',
    topic: 'Reply quotes in a thread',
    invite: [readerId, helper.userId],
  });
  await joinRoom(HOMESERVER, token, roomId);
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  await sendStateEvent(HOMESERVER, owner.accessToken, roomId, 'io.mindroom.router', '', {
    user_id: owner.userId,
  });
  await sendStateEvent(
    HOMESERVER,
    owner.accessToken,
    roomId,
    'io.mindroom.accounts',
    owner.userId,
    { accounts: [helper.userId, owner.userId].sort() }
  );
  const send = (accessToken: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, accessToken, roomId, content, 'reply-quotes');

  const rootId = await send(token, { msgtype: 'm.text', body: 'Starting a new job today' });
  await signIn(page, username);
  await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);
  const row = (eventId: string) => page.locator(`[data-message-id="${eventId}"]`).first();
  await expect(row(rootId)).toBeVisible({ timeout: 120_000 });
  const voiceId = await send(token, {
    msgtype: 'm.audio',
    body: 'Voice message',
    url: await uploadVoiceClip(token),
    info: { mimetype: 'audio/wav', duration: 2_000 },
    'org.matrix.msc1767.audio': { duration: 2_000, waveform: [] },
    'org.matrix.msc3245.voice': {},
    'm.relates_to': inThread(rootId, rootId, true),
  });
  const pending = row(voiceId).getByRole('status', { name: 'Transcribing…' });
  await expect(pending).toBeVisible({ timeout: 30_000 });
  const transcriptId = await send(helper.accessToken, {
    msgtype: 'm.text',
    body: "🎤 It's my first day on the job.",
    'com.mindroom.visible_router_voice_echo': true,
    'com.mindroom.voice_source_event_id': voiceId,
    'com.mindroom.original_sender': readerId,
    'm.relates_to': inThread(rootId, voiceId, false),
  });
  await expect(row(voiceId)).toContainText("It's my first day on the job.");
  await expect(row(voiceId)).toContainText('Transcribed by Helper');
  await expect(pending).toHaveCount(0);
  await expect(page.locator(`[data-message-id="${transcriptId}"]`)).toHaveCount(0);
  const answerId = await send(helper.accessToken, {
    msgtype: 'm.text',
    body: 'Congratulations on the first day!',
    'm.relates_to': inThread(rootId, voiceId, false),
  });
  const asideId = await send(token, {
    msgtype: 'm.text',
    body: 'Also, lunch is at noon',
    'm.relates_to': inThread(rootId, answerId, true),
  });
  const laterId = await send(helper.accessToken, {
    msgtype: 'm.text',
    body: 'Back to your first day: good luck!',
    'm.relates_to': inThread(rootId, voiceId, false),
  });

  const quoteOfVoice = (eventId: string) => row(eventId).locator(`[data-event-id="${voiceId}"]`);
  await expect(row(laterId)).toContainText('Back to your first day', { timeout: 120_000 });
  await expect(row(asideId)).toBeVisible();
  await expect(row(answerId)).toBeVisible();

  // The later reply comes after an unrelated message, so it quotes the voice message.
  await expect(quoteOfVoice(laterId)).toBeVisible({ timeout: 30_000 });
  await expect(quoteOfVoice(laterId)).toContainText('Voice message');

  const screenshot = process.env.REPLY_QUOTES_SCREENSHOT;
  if (screenshot) {
    await row(voiceId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot });
  }
  // The answer immediately follows the voice message with its folded transcript.
  await expect(quoteOfVoice(answerId)).toHaveCount(0);
});
