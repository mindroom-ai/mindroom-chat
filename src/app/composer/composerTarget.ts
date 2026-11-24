/** Rendered and not inert (under a side panel, behind the phone's navigation drawer). */
export const isComposerShown = (root: HTMLElement | null | undefined): boolean =>
  !!root?.isConnected && !root.closest('[inert]') && root.getClientRects().length > 0;

export type ComposerTargetCandidate = {
  root: () => HTMLElement | null;
  container?: () => HTMLElement | null;
  thread: boolean;
};

/**
 * Picks the composer a shortcut acts in among visible candidates: focused composer, else focused
 * conversation container, else open thread composer, else first visible composer.
 */
export const pickComposerTarget = <T extends ComposerTargetCandidate>(
  entries: readonly T[],
  focused: Element | null = document.activeElement
): T | undefined =>
  entries.find((entry) => focused !== null && Boolean(entry.root()?.contains(focused))) ??
  entries.find((entry) => focused !== null && Boolean(entry.container?.()?.contains(focused))) ??
  entries.find((entry) => entry.thread) ??
  entries[0];
