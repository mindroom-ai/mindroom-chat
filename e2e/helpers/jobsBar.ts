import type { Page } from '@playwright/test';

/** A change of the shell call's jobs bar: its title, or null once it is gone, by the page's clock. */
export type JobsBarChange = { at: number; label: string | null };

declare global {
  interface Window {
    jobsBarChanges?: JobsBarChange[];
  }
}

/**
 * Records every change of the jobs bar that names `run_shell_command` from now on, as the client
 * commits it to the DOM (a frame loop can starve in a WebKit page and miss a short state).
 */
export const watchJobsBar = (page: Page) =>
  page.evaluate(() => {
    const changes: JobsBarChange[] = [];
    window.jobsBarChanges = changes;
    let last: string | null | undefined;
    const read = () => {
      const label =
        [...document.querySelectorAll('[role="region"]')]
          .map((region) => region.getAttribute('aria-label') ?? '')
          .find((name) => name.includes('run_shell_command')) ?? null;
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
  });

export const jobsBarChanges = (page: Page): Promise<JobsBarChange[]> =>
  page.evaluate(() => window.jobsBarChanges ?? []);
