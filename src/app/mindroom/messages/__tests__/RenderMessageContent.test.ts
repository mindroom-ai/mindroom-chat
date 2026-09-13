import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const toolApprovalCardMock = vi.hoisted(() => vi.fn());
const renderMindroomMessageContentMock = vi.hoisted(() => vi.fn());

vi.mock('folds', () => ({
  Box: ({ children, as: asElement = 'div', ...props }: any) =>
    React.createElement(asElement, props, children),
  Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
  Icons: {
    Clock: 'Clock',
    Delete: 'Delete',
    Lock: 'Lock',
    Warning: 'Warning',
  },
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('span', props, children),
  as: (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
    React.forwardRef(render),
  color: {
    Critical: { Main: '#f00' },
    Warning: { Main: '#fc0' },
  },
  config: {
    opacity: {
      P300: '0.6',
    },
    space: {
      S200: '8px',
    },
  },
}));

vi.mock('../../../components/message', () => ({
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
  MText: ({ content, renderStateSuffix }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'text' },
      typeof content.body === 'string' ? content.body : '',
      renderStateSuffix?.()
    ),
  MVideo: () => null,
  ReadPdfFile: () => null,
  ReadTextFile: () => null,
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
  ThumbnailContent: () => null,
  UnsupportedContent: () => React.createElement('div', { 'data-renderer': 'unsupported' }),
  VideoContent: () => null,
}));

vi.mock('../../../components/url-preview', () => ({
  UrlPreviewCard: () => null,
  UrlPreviewHolder: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../components/media', () => ({
  Image: () => null,
  MediaControl: () => null,
  Video: () => null,
}));

vi.mock('../../../components/image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('../../../components/Pdf-viewer', () => ({
  PdfViewer: () => null,
}));

vi.mock('../../../components/text-viewer', () => ({
  TextViewer: () => null,
}));

vi.mock('../../../plugins/matrix-to', () => ({
  testMatrixTo: () => false,
}));

vi.mock('../renderMindroomMessageContent', () => ({
  renderMindroomMessageContent: renderMindroomMessageContentMock,
}));

vi.mock('../PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('../longText', () => ({
  getMindroomLongTextSource: () => undefined,
}));

vi.mock('../MindroomLongTextText', () => ({
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: () => null,
}));

vi.mock('../MindroomToolApprovalCard', () => ({
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

vi.mock('../../../plugins/react-custom-html-parser', () => ({
  withMindroomToolTraceMarkerParserOptions: (options: unknown) => options,
}));

describe('RenderMessageContent', () => {
  it('delegates MindRoom-specific message content to the MindRoom renderer seam', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'mindroom-message' }, 'delegated')
    );
    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: 'm.notice',
        ts: 0,
        showMessageExtras: true,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Summary body',
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('mindroom-message');
    expect(rendered).toContain('delegated');
    expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: 'm.notice',
        showMessageExtras: true,
        content: expect.objectContaining({
          body: 'Summary body',
        }),
      })
    );

    renderer.unmount();
  });

  it('renders the summary card when thread summary metadata is present on a legacy msgtype', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'summary-card' }, 'Rendered summary text')
    );

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
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'summary-card' }, 'Edited summary body')
    );

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
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'tool-approval' }, 'web_search')
    );
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
    expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        content: expect.objectContaining({
          tool_name: 'web_search',
        }),
      })
    );

    renderer.unmount();
  });

  it('renders the pending send suffix on image captions', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(undefined);

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.image',
        ts: 0,
        pendingSend: true,
        getContent: (() => ({
          msgtype: 'm.image',
          body: 'Caption text',
          filename: 'image.png',
          url: 'mxc://example/image',
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Caption text');
    expect(rendered).toContain('Message sending');

    renderer.unmount();
  });
});
