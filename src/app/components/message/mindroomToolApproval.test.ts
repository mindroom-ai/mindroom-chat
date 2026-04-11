import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApproval,
  parseToolApprovalContent,
} from './mindroomToolApproval';

const makeApprovalEvent = (content: Record<string, unknown>, type = MINDROOM_TOOL_APPROVAL_EVENT) =>
  new MatrixEvent({
    content,
    event_id: '$approval',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

describe('parseToolApproval', () => {
  it('parses a pending approval event', () => {
    const event = makeApprovalEvent({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      status: 'pending',
      created_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      status: 'pending',
      createdAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
    });
  });

  it('prefers m.new_content but falls back to original fields omitted by the edit wrapper', () => {
    const event = makeApprovalEvent({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      status: 'pending',
      created_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
      'm.new_content': {
        status: 'approved',
        resolved_at: '2026-04-10T12:05:00Z',
        resolved_by: '@bob:example.org',
      },
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      status: 'approved',
      createdAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@bob:example.org',
      resolutionReason: null,
    });
  });

  it('preserves original fields when building render content for partial edits', () => {
    expect(
      parseToolApprovalContent(
        MINDROOM_TOOL_APPROVAL_EVENT,
        getToolApprovalRenderContent(
          {
            approval_id: 'approval-1',
            tool_name: 'web_search',
            arguments: { query: 'NixOS 26.05 release date' },
            agent_name: 'research',
            status: 'pending',
            created_at: '2026-04-10T12:00:00Z',
            expires_at: '2026-04-17T12:00:00Z',
            resolved_at: null,
            resolved_by: null,
            resolution_reason: null,
          },
          {
            'm.new_content': {
              status: 'denied',
              resolved_at: '2026-04-10T12:05:00Z',
              resolved_by: '@bob:example.org',
              resolution_reason: 'Missing justification',
            },
          }
        )
      )
    ).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      status: 'denied',
      createdAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@bob:example.org',
      resolutionReason: 'Missing justification',
    });
  });

  it('returns null for invalid event types and malformed content', () => {
    expect(
      parseToolApproval(
        makeApprovalEvent(
          {
            approval_id: 'approval-1',
          },
          'm.room.message'
        )
      )
    ).toBeNull();

    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: [],
        agent_name: 'research',
        status: 'pending',
        created_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      })
    ).toBeNull();
  });
});
