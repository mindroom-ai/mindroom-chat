import type { Locator } from '@playwright/test';
import {
  expect,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
} from '../helpers/agentStack';

// A canvas title an agent wrote reads in its own direction, as a thread title does: in the
// English interface the Arabic title "لوحة التخطيط deploy.yaml للإطلاق" reads right to left in
// the panel's header and in the thread's canvas line, so its first word stays at the right and
// the file name keeps its place between the Arabic words. CANVAS_DIRECTION_SHOTS names a
// directory for a screenshot.
test.describe.configure({ timeout: 300_000 });

const TITLE = 'لوحة التخطيط deploy.yaml للإطلاق';
const SHOTS = process.env.CANVAS_DIRECTION_SHOTS;

/** The title's direction, and whether its first word shows to the right of its last. */
const reading = (title: Locator) =>
  title.evaluate((element) => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) {
      throw new Error('The title has no text of its own');
    }
    const range = document.createRange();
    const left = (offset: number) => {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getBoundingClientRect().left;
    };
    return {
      direction: getComputedStyle(element).direction,
      firstWordRight: left(0) > left(text.textContent.length - 1),
    };
  });

test(
  'an Arabic canvas title keeps its own direction in the English interface',
  { tag: '@webkit' },
  async ({ page, stack }, testInfo) => {
    test.skip(stack.model !== 'stub', 'only the stub model writes this title');
    await openLobby(page, stack);
    const rootId = await startThread(stack, `${uniqueWord('canvasrtl')} #canvasrtl`);
    await showThread(page, stack, rootId);

    const open = page.getByRole('button', { name: 'Open canvas', exact: true }).first();
    await expect(open).toBeVisible({ timeout: 120_000 });
    const panel = page.getByRole('complementary', { name: 'Canvas panel' });
    if (!(await panel.isVisible())) await open.click();
    await expect(panel).toBeVisible();

    const header = panel.getByText(TITLE, { exact: true });
    const line = page.locator('[data-canvas-notice-title]').getByText(TITLE, { exact: true });
    await expect(header).toBeVisible();
    await expect(line.first()).toBeVisible();
    expect(await reading(header)).toEqual({ direction: 'rtl', firstWordRight: true });
    expect(await reading(line.first())).toEqual({ direction: 'rtl', firstWordRight: true });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-canvas.png` });
  }
);
