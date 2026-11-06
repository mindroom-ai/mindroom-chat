import type { BrowserContext } from '@playwright/test';

const FAILURE_TEXTS = [
  // The startup failure screen (ClientRoot.tsx).
  'Failed to start account',
  // The error boundary's failed screen.
  "MindRoom ran into a problem and couldn't show this screen.",
];

/**
 * Records every startup failure screen or failed screen that any page of `context` shows, with
 * the page's address, also one that a retry or reload replaces a moment later: waiting for the
 * signed-in shell alone misses a failure that came and went, and the shell helpers press Retry.
 * Call it before the context opens its pages.
 */
export const recordStartFailures = async (context: BrowserContext): Promise<string[]> => {
  const failures: string[] = [];
  await context.exposeBinding('noteStartFailure', ({ page }, text: string) => {
    failures.push(`${page.url()}: ${text}`);
  });
  await context.addInitScript((texts: string[]) => {
    const noted = new Set<Node>();
    const look = () => {
      // Both screens put their text in an alert.
      document.querySelectorAll('[role="alert"]').forEach((node) => {
        const text = node.textContent ?? '';
        if (noted.has(node) || !texts.some((failure) => text.includes(failure))) return;
        noted.add(node);
        (window as unknown as { noteStartFailure: (text: string) => void }).noteStartFailure(text);
      });
    };
    new MutationObserver(look).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, FAILURE_TEXTS);
  return failures;
};
