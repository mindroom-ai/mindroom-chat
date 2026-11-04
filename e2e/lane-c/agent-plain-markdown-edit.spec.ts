import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

// A finished agent reply whose final edit carries the Markdown body alone (no formatted_body),
// as a MindRoom agent's long tool-heavy reply arrived on 2026-11-04.
const FINAL_BODY = [
  '🔧 `run_shell_command` [1]',
  '',
  '🔧 `read_file` [2]',
  '',
  '**What changed**',
  '',
  '- the first point, with `inline code`',
  '- the second point',
  '',
  'Done.',
].join('\n');

test.describe('agent reply whose final edit has no formatted_body', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('renders the Markdown body as Markdown', async ({ page }, testInfo) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Agent Markdown ${Date.now()}`,
    });
    const agent = await registerAgentAccount(homeserver, 'helper');
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
      method: 'POST',
      accessToken,
      body: JSON.stringify({ user_id: agent.userId }),
    });
    await joinRoom(homeserver, agent.accessToken, roomId);

    const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Please check the logs',
    });
    const thread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: false,
      'm.in_reply_to': { event_id: rootId },
    };
    const stubId = await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Thinking...',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Thinking...</p>\n',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': thread,
    });
    const finalContent = {
      msgtype: 'm.text',
      body: FINAL_BODY,
      'io.mindroom.stream_status': 'completed',
    };
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      ...finalContent,
      body: `* ${FINAL_BODY}`,
      'm.new_content': { ...finalContent, 'm.relates_to': thread },
      'm.relates_to': { rel_type: 'm.replace', event_id: stubId },
    });

    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    const reply = page.locator('[data-message-item]').filter({ hasText: 'the second point' });
    await expect(reply).toHaveCount(1, { timeout: 60_000 });

    await expect(reply.locator('strong', { hasText: 'What changed' })).toBeVisible();
    await expect(reply.locator('li')).toHaveCount(2);
    await expect(reply.locator('li code', { hasText: 'inline code' })).toBeVisible();
    await expect(reply).not.toContainText('**What changed**');
    await expect(reply).not.toContainText('- the second point');
    // The tool lines stay tool rows, not literal backticks.
    await expect(reply).not.toContainText('`run_shell_command`');

    if (SCREENSHOT) {
      await reply.screenshot({ path: `${SCREENSHOT}/L5-agent-markdown-edit.png` });
    }
    await testInfo.attach('reply', { body: await reply.screenshot(), contentType: 'image/png' });
  });
});
