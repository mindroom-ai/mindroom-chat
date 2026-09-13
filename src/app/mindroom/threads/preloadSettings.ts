export const DEFAULT_PAGINATION_LIMIT = 10000;
export const MIN_PAGINATION_LIMIT = 50;
export const THREAD_BATCH_SIZE = 200;

export const sanitizePaginationLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGINATION_LIMIT;
  return Math.max(Math.trunc(value), MIN_PAGINATION_LIMIT);
};
