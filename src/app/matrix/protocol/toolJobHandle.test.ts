import { describe, expect, it } from 'vitest';
import { parseToolJobHandle } from './toolJobHandle';

describe('parseToolJobHandle', () => {
  it('reads the job and its status from the handle a detached call returns', () => {
    expect(
      parseToolJobHandle(
        '{"job_id": "f85f0a95", "tool": "run_shell_command", "status": "awaiting_approval", "summary": null, "summary_truncated": false}'
      )
    ).toEqual({ jobId: 'f85f0a95', status: 'awaiting_approval' });
  });

  it('treats any other result as no handle', () => {
    expect(parseToolJobHandle(undefined)).toBeUndefined();
    expect(parseToolJobHandle('not now')).toBeUndefined();
    expect(parseToolJobHandle('{"job_id": "f85f0a95", "tool": "run_shell')).toBeUndefined();
    expect(parseToolJobHandle('{"status": "ok", "tool": "run_shell_command"}')).toBeUndefined();
    expect(parseToolJobHandle('["job_id"]')).toBeUndefined();
  });
});
