// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseToolApprovalContent } from '../matrix/protocol/toolApproval';
import { ApprovalReceipt } from './ApprovalReceipt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PERSON = '@usera:example.org';
const AGENT = '@mindroom_helper:example.org';
const NAMES: Record<string, string> = { [PERSON]: 'User A', [AGENT]: 'Helper' };
const room = {
  getMember: (userId: string) => (NAMES[userId] ? { name: NAMES[userId] } : null),
  getJoinedMembers: () => Object.entries(NAMES).map(([userId, name]) => ({ userId, name })),
};
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => PERSON, getRoom: () => room }),
}));
vi.mock('./ThreadApprovalProvider', () => ({ useThreadApprovals: () => undefined }));

afterEach(() => {
  document.body.replaceChildren();
});

it('names the people of an expanded receipt by their display names', () => {
  const approval = parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: 'call-1',
    tool_name: 'run_shell_command',
    agent_name: 'helper',
    status: 'approved',
    requester_id: PERSON,
    approver_user_id: PERSON,
    arguments: { command: 'date' },
    requested_at: '2026-11-05T12:00:00Z',
    expires_at: '2026-11-12T12:00:00Z',
    resolved_by: PERSON,
    approval_provenance: {
      kind: 'scheduled_approval',
      approved_by: PERSON,
      approved_at: '2026-11-05T12:01:00Z',
      scheduled_for: '2026-11-05T13:00:00Z',
      scope: 'exact_arguments',
    },
  })!;
  expect(approval.provenance?.kind).toBe('scheduled_approval');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ApprovalReceipt approval={approval} roomId="!room:example.org" />));
  const text = container.textContent ?? '';
  expect(text).toContain('Helper · Requested by User A');
  expect(text).toContain('Approved by User A');
  expect(text).toContain('Approved when scheduled by User A');
  expect(text).not.toContain(PERSON);
  act(() => root.unmount());
});
