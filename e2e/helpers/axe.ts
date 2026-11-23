import path from 'node:path';
import type { Page } from '@playwright/test';

// axe-core comes with eslint-plugin-jsx-a11y; a spec skips its axe test if it is ever gone.
export const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');

/** Critical and serious axe-core findings on the page, as `rule: element` lines. */
export const axeFindings = async (page: Page): Promise<string[]> => {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    type AxeResult = {
      violations: {
        id: string;
        impact: string | null;
        nodes: { target: string[]; html: string }[];
      }[];
    };
    const { axe } = window as unknown as {
      axe: { run: (context: Document) => Promise<AxeResult> };
    };
    const result = await axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .flatMap((violation) =>
        violation.nodes.map((node) => `${violation.id}: ${node.html.slice(0, 300)}`)
      );
  });
};
