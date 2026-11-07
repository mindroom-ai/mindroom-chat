/**
 * The route `handle` of a section's own page (Home, Direct Messages, a space, the Inbox, Explore):
 * where a phone shows the section's list, which its navigation drawer holds.
 */
export const SECTION_ROOT_HANDLE = { sectionRoot: true } as const;

/** Whether a matched route's `handle` marks a section's own page. */
export const isSectionRootHandle = (handle: unknown): boolean =>
  typeof handle === 'object' && handle !== null && 'sectionRoot' in handle;
