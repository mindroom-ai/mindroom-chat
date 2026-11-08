import type { Page } from '@playwright/test';

/** A change of the shell call's jobs bar: its title, or null once it is gone, by the page's clock. */
export type JobsBarChange = { at: number; label: string | null };

declare global {
  interface Window {
    jobsBarChanges?: JobsBarChange[];
  }
}

/** Records every change of the jobs bar that names `run_shell_command` from now on, read each frame. */
export const watchJobsBar = (page: Page) =>
  page.evaluate(() => {
    const changes: JobsBarChange[] = [];
    window.jobsBarChanges = changes;
    const read = () => {
      const label =
        [...document.querySelectorAll('[role="region"]')]
          .map((region) => region.getAttribute('aria-label') ?? '')
          .find((name) => name.includes('run_shell_command')) ?? null;
      if (changes.length === 0 || label !== changes[changes.length - 1].label) {
        changes.push({ at: Date.now(), label });
      }
      requestAnimationFrame(read);
    };
    read();
  });

export const jobsBarChanges = (page: Page): Promise<JobsBarChange[]> =>
  page.evaluate(() => window.jobsBarChanges ?? []);
