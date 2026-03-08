export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';

export const getThreadInitialRenderMode = ({
  threadId,
  initialCacheHydrated,
  fallbackEventCount,
}: {
  threadId?: string;
  initialCacheHydrated: boolean;
  fallbackEventCount: number;
}): ThreadInitialRenderMode => {
  if (!threadId) return 'live';
  if (initialCacheHydrated) return 'live';
  return fallbackEventCount > 0 ? 'cached' : 'loading';
};
