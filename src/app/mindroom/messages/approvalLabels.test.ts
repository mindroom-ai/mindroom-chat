import { describe, expect, it } from 'vitest';
import { describeApprovalHistory, describeWaitingApprovals } from './approvalLabels';
import type { ThreadApprovalRecord } from './threadApprovalModel';
import type { ToolApprovalData } from './toolApproval';

const record = (overrides: Partial<ToolApprovalData>, eventId = '$one'): ThreadApprovalRecord => {
  const approval = {
    approvalId: eventId,
    toolName: 'read_file',
    agentName: 'research',
    status: 'pending',
    resolvedBy: null,
    scope: null,
    ...overrides,
  } as ToolApprovalData;
  return {
    eventId,
    sender: '@mindroom_research:example.org',
    approval,
    wireStatus: approval.status,
  };
};

describe('describeApprovalHistory', () => {
  it('names one decision by its resolver, using "you" for the viewer', () => {
    expect(
      describeApprovalHistory(
        [record({ status: 'approved', resolvedBy: '@me:example.org' })],
        '@me:example.org'
      )
    ).toEqual({ kind: 'single', status: 'approved', actor: 'you', operation: 'read_file' });
    expect(
      describeApprovalHistory(
        [record({ status: 'denied', toolName: 'run_shell', resolvedBy: '@grace:example.org' })],
        '@me:example.org'
      )
    ).toEqual({
      kind: 'single',
      status: 'denied',
      actor: { userId: '@grace:example.org' },
      operation: 'run_shell',
    });
  });

  it('omits the actor when nobody resolved the call, as with expiry', () => {
    expect(describeApprovalHistory([record({ status: 'expired' })], '@me:example.org')).toEqual({
      kind: 'single',
      status: 'expired',
      actor: null,
      operation: 'read_file',
    });
  });

  it('counts several decisions', () => {
    expect(
      describeApprovalHistory(
        [record({ status: 'approved' }, '$a'), record({ status: 'denied' }, '$b')],
        '@me:example.org'
      )
    ).toEqual({ kind: 'count', total: 2, approved: 1 });
  });
});

describe('describeWaitingApprovals', () => {
  it('names the agent and counts repeated tools', () => {
    expect(
      describeWaitingApprovals([
        [record({ toolName: 'send_email' }, '$a')],
        [record({ toolName: 'send_message' }, '$b'), record({ toolName: 'send_message' }, '$c')],
      ])
    ).toEqual({
      agents: ['research'],
      tools: [
        { operation: 'send_email', count: 1 },
        { operation: 'send_message', count: 2 },
      ],
    });
  });

  it('lists each distinct agent once', () => {
    expect(
      describeWaitingApprovals([
        [record({ agentName: 'research' }, '$a')],
        [record({ agentName: 'planner', toolName: 'create_event' }, '$b')],
      ]).agents
    ).toEqual(['research', 'planner']);
  });
});
