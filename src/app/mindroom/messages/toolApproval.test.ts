import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildToolApprovalResponseContent,
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApproval,
  parseToolApprovalContent,
} from './toolApproval';

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
      tool_call_id: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      status: 'pending',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
    });
  });

  it('prefers m.new_content but falls back to original fields omitted by the edit wrapper', () => {
    const event = makeApprovalEvent({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      tool_call_id: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
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
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      status: 'approved',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
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
            tool_call_id: 'approval-1',
            arguments: { query: 'NixOS 26.05 release date' },
            agent_name: 'research',
            requester_id: '@alice:example.org',
            status: 'pending',
            requested_at: '2026-04-10T12:00:00Z',
            expires_at: '2026-04-17T12:00:00Z',
            thread_id: '$thread-root',
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
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      status: 'denied',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@bob:example.org',
      resolutionReason: 'Missing justification',
    });
  });

  it('parses the live backend approval payload', () => {
    const event = new MatrixEvent({
      content: {
        agent_name: 'research',
        approval_id: '55f1497940554e32bb0aa7e4362180c2',
        arguments: {
          max_results: 5,
          query: 'Python 3.14 release notes',
        },
        body: '\ud83d\udd12 Approval required: web_search',
        expires_at: '2026-04-26T02:46:29.899252+00:00',
        'm.relates_to': {
          event_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
          is_falling_back: true,
          'm.in_reply_to': {
            event_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
          },
          rel_type: 'm.thread',
        },
        msgtype: 'io.mindroom.tool_approval',
        requested_at: '2026-04-19T02:46:29.899252+00:00',
        requester_id: '@e2e-test-bot:mindroom.lab.mindroom.chat',
        status: 'pending',
        thread_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
        tool_call_id: '55f1497940554e32bb0aa7e4362180c2',
        tool_name: 'web_search',
      },
      event_id: '$eOCPvb7zqpxBrpb7Mbx5K0K19wHnmJIsLJkqs4jGViY',
      origin_server_ts: 1776566789914,
      room_id: '!XOnr2BckWWezk7JpEv:mindroom.lab.mindroom.chat',
      sender: '@mindroom_research_adb4d443:mindroom.lab.mindroom.chat',
      type: 'io.mindroom.tool_approval',
      unsigned: {
        age: 365890,
        transaction_id: '53c35778-e55c-4636-aa7e-2ccdd2c3b013',
      },
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: '55f1497940554e32bb0aa7e4362180c2',
      toolName: 'web_search',
      toolCallId: '55f1497940554e32bb0aa7e4362180c2',
      arguments: {
        max_results: 5,
        query: 'Python 3.14 release notes',
      },
      agentName: 'research',
      requesterId: '@e2e-test-bot:mindroom.lab.mindroom.chat',
      status: 'pending',
      requestedAt: '2026-04-19T02:46:29.899252+00:00',
      expiresAt: '2026-04-26T02:46:29.899252+00:00',
      threadId: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
    });
  });

  it('builds Matrix approval response content with thread reply metadata', () => {
    expect(
      buildToolApprovalResponseContent(
        'denied',
        '$thread-root',
        '$approval',
        'Needs human review'
      )
    ).toEqual({
      status: 'denied',
      reason: 'Needs human review',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$thread-root',
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: '$approval',
        },
      },
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
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      })
    ).toBeNull();
  });
});
