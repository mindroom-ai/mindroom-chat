import { mkdirSync, readFileSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  expect,
  openLobby,
  openThread,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';

// A model can put bidirectional controls into a tool call's arguments. The stub's #bidi command
// holds a right-to-left override (U+202E) and its end (U+202C) around `; echo pwned-by-bidi #`:
// applied, they make the command read as one echo and a comment, while the shell runs a second
// echo. The review, in English and Arabic, the decision's receipt and the reply's tool call show
// the controls as code points instead and keep the command's own order. The WebKit run uses a
// phone's screen. AGENT_BIDI_SHOTS names a directory for screenshots.
test.describe.configure({ timeout: 300_000 });

const SHOWN = 'echo needs-approval hello <U+202E>; echo pwned-by-bidi #<U+202C> done';
const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;
const SHOTS = process.env.AGENT_BIDI_SHOTS;

type Catalog = { [key: string]: string | Catalog };
const arabic = JSON.parse(
  readFileSync(new URL('../../src/app/i18n/locales/ar.json', import.meta.url), 'utf8')
) as Catalog;
const arabicText = (path: string): string => {
  const text = path
    .split('.')
    .reduce<string | Catalog | undefined>(
      (node, key) => (typeof node === 'object' ? node[key] : undefined),
      arabic
    );
  if (typeof text !== 'string') throw new Error(`No Arabic text at ${path}`);
  return text;
};

const shot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${name}.png` });
};

/** The arguments show the controls as code points, and no control reaches the page there. */
const expectShownInOrder = async (scope: Locator) => {
  await expect(scope).toContainText(SHOWN, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

const waitForApproval = (stack: AgentStack, rootId: string, status: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === 'io.mindroom.tool_approval' && event.content.status === status,
    { timeout: 90_000, description: `a ${status} tool approval` }
  );

const setLanguage = async (page: Page, stack: AgentStack, rootId: string, code: 'en' | 'ar') => {
  await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
  await openThread(page, stack, rootId);
  await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
};

test(
  'a held command shows its direction controls as code points instead of applying them',
  { tag: '@webkit' },
  async ({ page, stack }, testInfo) => {
    test.skip(stack.model !== 'stub', 'only the stub model writes direction controls');
    if (testInfo.project.name === 'webkit') await page.setViewportSize({ width: 390, height: 844 });
    await openLobby(page, stack);
    const rootId = await startThread(stack, `${uniqueWord('bidi')} #bidi`);
    await showThread(page, stack, rootId);
    await waitForApproval(stack, rootId, 'pending');

    // The review in English: the preview, then every argument.
    const bar = page.getByRole('region', { name: 'Thread approvals' });
    await bar.getByRole('button', { name: /^Review 1/ }).click({ timeout: 90_000 });
    let dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
    await expectShownInOrder(dialog.locator('dl').first());
    await shot(page, testInfo, 'review-en');
    await dialog.getByRole('button', { name: 'Show all arguments' }).click();
    await expectShownInOrder(dialog.locator('dl').first());
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The review in the Arabic interface.
    await setLanguage(page, stack, rootId, 'ar');
    const arabicBar = page.getByRole('region', {
      name: arabicText('mindroomUi.messages.threadApprovalControls.threadApprovals'),
    });
    const review = arabicText('mindroomUi.messages.threadApprovalControls.reviewCount');
    await arabicBar
      .getByRole('button', { name: new RegExp(`^${(review.split('\u2068')[0] ?? review).trim()}`) })
      .click({ timeout: 90_000 });
    dialog = page.getByRole('dialog');
    await expectShownInOrder(dialog.locator('dl').first());
    await shot(page, testInfo, 'review-ar');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Denied, never approved: the receipt and the reply's tool call show the same order.
    await setLanguage(page, stack, rootId, 'en');
    await bar.getByRole('button', { name: /^Review 1/ }).click({ timeout: 90_000 });
    dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
    await dialog.getByRole('button', { name: 'Deny' }).click();
    await dialog.getByRole('button', { name: 'Confirm deny' }).click();
    await expect(dialog).toContainText('Denied', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await waitForApproval(stack, rootId, 'denied');

    const receipt = page.getByRole('button', { name: /^You denied run_shell_command/ });
    await expectShownInOrder(receipt);
    // The reply's later edits can draw the call list closed again, so open it and read it at once.
    const toolCall = page.getByRole('button', { name: /^Denied 1 tool call/ });
    const row = page.locator('[data-tool-index="1"]').first();
    await expect(async () => {
      if ((await toolCall.getAttribute('aria-expanded')) !== 'true') await toolCall.click();
      const text = await row.textContent({ timeout: 2_000 });
      expect(text).toContain(SHOWN);
      expect(text).not.toMatch(CONTROL);
    }).toPass({ timeout: 60_000 });
    await shot(page, testInfo, 'denied-en');
  }
);
