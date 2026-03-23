export type ThreadResolutionContent = {
  thread_root_id: string;
  status: 'resolved';
  resolved_by: string;
  resolved_at: string;
  updated_at: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isThreadResolutionTombstone = (content: unknown): boolean =>
  isObject(content) && Object.keys(content).length === 0;

export const parseThreadResolutionContent = (
  content: unknown,
  expectedThreadRootId?: string | null
): ThreadResolutionContent | undefined => {
  if (!isObject(content) || isThreadResolutionTombstone(content)) {
    return undefined;
  }

  const { thread_root_id, status, resolved_by, resolved_at, updated_at } = content;
  if (
    status !== 'resolved' ||
    typeof thread_root_id !== 'string' ||
    typeof resolved_by !== 'string' ||
    typeof resolved_at !== 'string' ||
    typeof updated_at !== 'string'
  ) {
    return undefined;
  }

  if (expectedThreadRootId !== undefined && thread_root_id !== expectedThreadRootId) {
    return undefined;
  }

  return {
    thread_root_id,
    status,
    resolved_by,
    resolved_at,
    updated_at,
  };
};

export const isThreadResolved = (content: unknown): boolean =>
  !!parseThreadResolutionContent(content);

export const buildThreadResolvedContent = (
  threadRootId: string,
  resolvedBy: string,
  now = new Date().toISOString()
): ThreadResolutionContent => ({
  thread_root_id: threadRootId,
  status: 'resolved',
  resolved_by: resolvedBy,
  resolved_at: now,
  updated_at: now,
});
