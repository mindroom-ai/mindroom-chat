import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const toolApprovalCardMock = vi.hoisted(() => vi.fn());
const longTextTextMock = vi.hoisted(() => vi.fn());
const toolTraceParserOptionsMock = vi.hoisted(() => vi.fn((options: unknown) => options));

vi.mock('../../components/message', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
  MEmote: () => React.createElement('div', { 'data-renderer': 'emote' }),
  MNotice: () => React.createElement('div', { 'data-renderer': 'notice' }),
  MText: () => React.createElement('div', { 'data-renderer': 'text' }),
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
}));

vi.mock('../../plugins/react-custom-html-parser', () => ({
  withMindroomToolTraceMarkerParserOptions: toolTraceParserOptionsMock,
}));

vi.mock('./MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: ({ summaryInfo }: { summaryInfo: { summaryText?: string } }) =>
    React.createElement('div', { 'data-renderer': 'summary-card' }, summaryInfo.summaryText),
}));

vi.mock('./MindroomToolApprovalCard', () => ({
  MindroomToolApprovalCard: ({
    approval,
    eventId,
    roomId,
    threadId,
  }: {
    approval: { toolName: string };
    eventId?: string;
    roomId?: string;
    threadId?: string;
  }) => {
    toolApprovalCardMock({ approval, eventId, roomId, threadId });
    return React.createElement('div', { 'data-renderer': 'tool-approval' }, approval.toolName);
  },
}));

vi.mock('./MindroomLongTextText', () => ({
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: ({ kind }: { kind: string }) => {
    longTextTextMock({ kind });
    return React.createElement('div', { 'data-renderer': 'long-text' }, kind);
  },
}));

const renderNode = async (
  options: Partial<Parameters<typeof import('./renderMindroomMessageContent').renderMindroomMessageContent>[0]>
) => {
  const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
  return create(
    React.createElement(
      React.Fragment,
      null,
      renderMindroomMessageContent({
        displayName: 'MindRoom',
        msgType: 'm.text',
        content: {
          msgtype: 'm.text',
          body: 'Hello',
        },
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
        ...options,
      })
    )
  );
};

describe('renderMindroomMessageContent', () => {
  it('renders thread summary metadata through the MindRoom summary card', async () => {
    const renderer = await renderNode({
      msgType: 'm.notice',
      content: {
        msgtype: 'm.notice',
        body: 'Summary body',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Rendered summary text',
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('notice');

    renderer.unmount();
  });

  it('renders tool approval events through the MindRoom approval card', async () => {
    toolApprovalCardMock.mockReset();

    const renderer = await renderNode({
      eventType: 'io.mindroom.tool_approval',
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
      msgType: '',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
        resolved_at: null,
        resolved_by: null,
        resolution_reason: null,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('tool-approval');
    expect(rendered).toContain('web_search');
    expect(toolApprovalCardMock).toHaveBeenCalledWith({
      approval: expect.objectContaining({
        toolName: 'web_search',
      }),
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
    });

    renderer.unmount();
  });

  it('renders long-text metadata before falling back to normal file rendering', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.file',
      content: {
        msgtype: 'm.file',
        body: 'Long output.txt',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('long-text');
    expect(longTextTextMock).toHaveBeenCalledWith({
      kind: 'text',
    });

    renderer.unmount();
  });

  it('returns undefined for non-MindRoom media messages so generic rendering can handle them', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');

    const rendered = renderMindroomMessageContent({
      displayName: 'MindRoom',
      msgType: 'm.image',
      content: {
        msgtype: 'm.image',
        body: 'image.png',
      },
      htmlReactParserOptions: {} as never,
      linkifyOpts: {} as never,
    });

    expect(rendered).toBeUndefined();
  });
});
