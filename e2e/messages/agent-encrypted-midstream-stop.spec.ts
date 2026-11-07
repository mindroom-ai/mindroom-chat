import { writeFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  routeClientConfig,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-e2ee-F009): a device that signed in while an agent's reply streamed in an
// encrypted room showed the growing text but no Stop button, while the account's other devices
// showed one. The Stop button is the agent's 🛑 reaction on its reply. The reaction, and the
// reply's first event, came before the new device existed: the reply could not be decrypted
// there (only its later edits could), and the reaction lay behind many streaming edits the device
// never loaded. Stop must show from the server's state of the reply, not only from what the device
// saw since the reply started.
test.describe.configure({ timeout: 360_000 });

// Set E2EE_SHOTS=<directory> to save the new device's thread.
const SHOTS = process.env.E2EE_SHOTS;

/** The reader's own message in the room, which roots the reply's thread. */
const readerRoot = async (stack: AgentStack, roomId: string): Promise<string> => {
  type Raw = { event_id: string; sender: string; content: { 'm.relates_to'?: unknown } };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
    { accessToken: stack.tester.accessToken }
  );
  const root = chunk.find(
    (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
  );
  if (!root) throw new Error("The reader's message is not in the room");
  return root.event_id;
};

/** A new device of the tester at its sign-in form, filled in, so signing in takes one click. */
const readySignIn = async (
  browser: Browser,
  stack: AgentStack,
  baseURL: string | undefined
): Promise<Page> => {
  const context = await browser.newContext({
    storageState: undefined,
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await routeClientConfig(page, stack);
  await page.goto(`/login/${encodeURIComponent(stack.homeserver)}`, { timeout: 180_000 });
  await page.locator('input[name="usernameInput"]').fill(stack.tester.username);
  await page.locator('input[name="passwordInput"]').fill(stack.tester.password);
  return page;
};

const stop = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

/** The stream status the helper's newest edit carries in the clear, as the server has it. */
const serverStatus = async (stack: AgentStack, roomId: string): Promise<string> => {
  type Raw = { sender: string; content: Record<string, unknown> };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=5`,
    { accessToken: stack.tester.accessToken }
  );
  const edit = chunk.find(
    (event) => event.sender === stack.agents.helper && event.content['io.mindroom.stream_status']
  );
  return String(edit?.content['io.mindroom.stream_status'] ?? 'unknown');
};

const signedInMidStreamShowsStop = async (
  page: Page,
  stack: AgentStack,
  browser: Browser,
  baseURL: string | undefined
) => {
  const roomId = await createEncryptedAgentRoom(stack, 'Secure midstream');
  const fresh = await readySignIn(browser, stack, baseURL);
  const log: string[] = [];
  // Which responses brought the new device the agent's 🛑 reaction, for the record.
  fresh.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes('/_matrix/client/')) return;
    void response
      .text()
      .then((body) => {
        if (body.includes('🛑') || body.includes('\\ud83d\\uded1')) {
          log.push(`🛑 in ${url.pathname.replace(/![^/]+/, '<room>').slice(0, 80)}`);
        }
      })
      .catch(() => undefined);
  });
  try {
    await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await expect(composer(page)).toBeVisible({ timeout: 90_000 });
    // 400 words, one every quarter second.
    await mentionHelper(page, stack, '#stopme a long answer please');
    await expect(page.getByText(/\bword5\b/).first()).toBeVisible({ timeout: 90_000 });
    await expect(stop(page)).toBeVisible();
    const rootId = await readerRoot(stack, roomId);

    // The new device signs in while the reply streams and opens its thread.
    await fresh.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(
      fresh.getByRole('button', { name: activeAccountButtonNamePattern }).first()
    ).toBeVisible({ timeout: 240_000 });
    await fresh.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`, {
      timeout: 180_000,
    });
    // Whatever of the reply it can decrypt (the edits sent after it signed in, once the agent
    // shares its key with it), the reply still streams on the server.
    const words = async () => {
      const text = await fresh.locator('body').innerText();
      const numbers = [...text.matchAll(/\bword(\d+)\b/g)].map((match) => Number(match[1]));
      return numbers.length > 0 ? Math.max(...numbers) : 0;
    };
    await expect(fresh.locator('[data-message-id]').nth(1)).toBeVisible({ timeout: 90_000 });
    log.push(`thread shown at word${await words()} (server: ${await serverStatus(stack, roomId)})`);
    // The account's new device offers Stop, as its desk does.
    await expect(stop(fresh)).toBeVisible({ timeout: 20_000 });
    log.push(`Stop shown at word${await words()} (server: ${await serverStatus(stack, roomId)})`);
    const engine = fresh.context().browser()?.browserType().name() ?? 'browser';
    if (SHOTS) {
      // For the picture, the words the device can decrypt once the agent shares its key, if it does.
      await expect
        .poll(words, { timeout: 20_000 })
        .toBeGreaterThan(0)
        .catch(() => undefined);
      await fresh.screenshot({ path: `${SHOTS}/midstream-stop-${engine}.png` });
    }

    // And it stops the reply.
    await stop(fresh).click();
    await expect(fresh.getByText('[Response cancelled by user]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('[Response cancelled by user]').first()).toBeVisible({
      timeout: 60_000,
    });
    log.push(`stopped at word${await words()}`);
  } catch (error) {
    const engine = fresh.context().browser()?.browserType().name() ?? 'browser';
    await fresh
      .screenshot({ path: test.info().outputPath(`midstream-${engine}-failed.png`) })
      .catch(() => undefined);
    throw error;
  } finally {
    writeFileSync(test.info().outputPath('midstream.log'), `${log.join('\n')}\n`);
    await fresh.context().close();
  }
};

test('a device that signs in while an encrypted reply streams offers Stop', async ({
  page,
  stack,
  browser,
  baseURL,
}) => {
  await signedInMidStreamShowsStop(page, stack, browser, baseURL);
});

test('a device that signs in while an encrypted reply streams offers Stop (WebKit)', async ({
  page,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    await signedInMidStreamShowsStop(page, stack, webkit, baseURL);
  } finally {
    await webkit.close();
  }
});
