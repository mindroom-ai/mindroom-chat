import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

/**
 * Saves an open thread's page, its style sheets inlined and its scripts left out, as the page of
 * `scripts/perf/webkit-insert-probe.mjs`, which times inserting message rows under the app's
 * selectors in WebKit and Chromium. Opt in with PERF_WEBKIT_SNAPSHOT=<output file>; run it on the
 * production build (`e2e-slot.sh <n> --preview`). The thread holds placeholder text only.
 */

const output = process.env.PERF_WEBKIT_SNAPSHOT;
const REPLIES = 24;

const agentReply = (index: number) => {
  const items = ['Check the build cache', 'Run the placeholder suite', 'Compare the two drafts'];
  const html =
    `<p>Placeholder answer ${index}: the sample report looks fine, with <code>step_${index}</code> ` +
    `and a <a href="https://example.org/docs">docs link</a>.</p>` +
    `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` +
    (index % 3 === 0
      ? `<pre><code class="language-ts">const step = await run("sample", { retries: ${index} });</code></pre>`
      : '');
  return {
    msgtype: 'm.text',
    body: `Placeholder answer ${index}.`,
    format: 'org.matrix.custom.html',
    formatted_body: html,
  };
};

test.skip(!output, 'Set PERF_WEBKIT_SNAPSHOT to the output file');

test('an open thread page for the WebKit insert probe', async ({ page }) => {
  test.setTimeout(180_000);
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const agent = await registerAgentAccount(homeserver, 'probe');
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: 'Placeholder probe room',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Placeholder question about the sample project',
  });
  const inThread = { rel_type: 'm.thread', event_id: rootId, is_falling_back: true };
  for (let index = 1; index <= REPLIES; index += 1) {
    const fromAgent = index % 2 === 0;
    const content = fromAgent
      ? agentReply(index)
      : { msgtype: 'm.text', body: `Placeholder follow-up ${index} about the sample draft.` };
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, fromAgent ? agent.accessToken : session.accessToken, roomId, {
      ...content,
      'm.relates_to': { ...inThread, 'm.in_reply_to': { event_id: rootId } },
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithPassword(page, { homeserver, username, password });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.getByText(`Placeholder answer ${REPLIES}:`)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  const html = await page.evaluate(() => {
    const sheets = [...document.styleSheets].map((sheet, index) => {
      const name = sheet.href?.split('/').pop() ?? `inline-${index}`;
      const text = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      return `<style data-probe-sheet="${name}">${text}</style>`;
    });
    const root = document.documentElement.cloneNode(true) as HTMLElement;
    root
      .querySelectorAll('script, style, link[rel="stylesheet"], link[rel="modulepreload"]')
      .forEach((node) => node.remove());
    root.querySelector('head')?.insertAdjacentHTML('beforeend', sheets.join('\n'));
    return `<!doctype html>\n${root.outerHTML}`;
  });
  mkdirSync(dirname(output!), { recursive: true });
  writeFileSync(output!, html);
});
