import type { Page } from '@playwright/test';

/** A change of the shell call's jobs bar: its title, or null once it is gone, by the page's clock. */
export type JobsBarChange = { at: number; label: string | null };

declare global {
  interface Window {
    jobsBarChanges?: JobsBarChange[];
  }
}

/**
 * Records every change of the jobs bar that names the shell call from now on, as the client
 * commits it to the DOM (a frame loop can starve in a WebKit page and miss a short state). Without
 * the usage details (the default) the bar names `run_shell_command` in words, "Running a command";
 * with them, by its tool: pass `run_shell_command` as `name`.
 */
export const watchJobsBar = (page: Page, name = 'Running a command') =>
  page.evaluate((shown) => {
    const changes: JobsBarChange[] = [];
    window.jobsBarChanges = changes;
    let last: string | null | undefined;
    const read = () => {
      const label =
        [...document.querySelectorAll('[role="region"]')]
          .map((region) => region.getAttribute('aria-label') ?? '')
          .find((label) => label.includes(shown)) ?? null;
      if (label === last) return;
      changes.push({ at: Date.now(), label });
      last = label;
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      attributeFilter: ['aria-label'],
    });
    read();
  }, name);

export const jobsBarChanges = (page: Page): Promise<JobsBarChange[]> =>
  page.evaluate(() => window.jobsBarChanges ?? []);
