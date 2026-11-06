/** What a tool call returns when MindRoom moves it into a background job: the job and its status then. */
export type ToolJobHandle = { jobId: string; status: string };

/**
 * Reads a tool call's result as a job handle (`{"job_id": ..., "tool": ..., "status": ...}`), which
 * MindRoom returns when a call goes on as a background job, for example after its reply stopped
 * waiting for the call's approval. Any other result is not a handle.
 */
export const parseToolJobHandle = (result: string | undefined): ToolJobHandle | undefined => {
  if (!result?.trimStart().startsWith('{')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { job_id: jobId, tool, status } = value as Record<string, unknown>;
  return typeof jobId === 'string' &&
    jobId.length > 0 &&
    typeof tool === 'string' &&
    typeof status === 'string'
    ? { jobId, status }
    : undefined;
};
