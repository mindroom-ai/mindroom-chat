import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const toolApprovalCardMock = vi.fn();

vi.mock('folds', () => ({
  config: {
    space: {
      S200: '8px',
    },
  },
}));

vi.mock('./message', () => ({
  AudioContent: () => null,
  DownloadFile: () => null,
  FileContent: () => null,
  ImageContent: () => null,
  MAudio: () => null,
  MBadEncrypted: () => React.createElement('div', { 'data-renderer': 'bad-encrypted' }),
  MEmote: () => React.createElement('div', { 'data-renderer': 'emote' }),
  MFile: () => null,
  MImage: () => null,
  MLocation: () => React.createElement('div', { 'data-renderer': 'location' }),
  MNotice: () => React.createElement('div', { 'data-renderer': 'notice' }),
  MindroomThreadSummaryCard: ({ summaryInfo }: { summaryInfo: { summaryText?: string } }) =>
    React.createElement('div', { 'data-renderer': 'summary-card' }, summaryInfo.summaryText),
  MText: () => React.createElement('div', { 'data-renderer': 'text' }),
  MVideo: () => null,
  ReadPdfFile: () => null,
  ReadTextFile: () => null,
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
  ThumbnailContent: () => null,
  UnsupportedContent: () => React.createElement('div', { 'data-renderer': 'unsupported' }),
  VideoContent: () => null,
}));

vi.mock('./url-preview', () => ({
  UrlPreviewCard: () => null,
  UrlPreviewHolder: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./media', () => ({
  Image: () => null,
  MediaControl: () => null,
  Video: () => null,
}));

vi.mock('./image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('./Pdf-viewer', () => ({
  PdfViewer: () => null,
}));

vi.mock('./text-viewer', () => ({
  TextViewer: () => null,
}));

vi.mock('../plugins/matrix-to', () => ({
  testMatrixTo: () => false,
}));

vi.mock('./message/mindroomLongText', () => ({
  getMindroomLongTextSource: () => undefined,
}));

vi.mock('./message/MindroomLongTextText', () => ({
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: () => null,
}));

vi.mock('../mindroom/messages/MindroomToolApprovalCard', () => ({
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

vi.mock('../plugins/react-custom-html-parser', () => ({
  withMindroomToolTraceMarkerParserOptions: (options: unknown) => options,
}));

describe('RenderMessageContent', () => {
  it('renders the summary card when thread summary metadata is present on a legacy msgtype', async () => {
    const { RenderMessageContent } = await import('./RenderMessageContent');

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Rendered summary text',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('unsupported');

    renderer.unmount();
  });

  it('keeps rendering edited summaries as summary cards when m.new_content omits metadata', async () => {
    const { RenderMessageContent } = await import('./RenderMessageContent');

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        edited: true,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Edited summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Stale metadata summary',
          },
          'm.new_content': {
            msgtype: 'm.notice',
            body: 'Edited summary body',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Edited summary body');
    expect(rendered).not.toContain('notice');

    renderer.unmount();
  });

  it('renders the tool approval card for io.mindroom.tool_approval events', async () => {
    const { RenderMessageContent } = await import('./RenderMessageContent');
    toolApprovalCardMock.mockReset();

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: '',
        ts: 0,
        getContent: (() => ({
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
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('tool-approval');
    expect(rendered).toContain('web_search');
    expect(rendered).not.toContain('unsupported');
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
});
