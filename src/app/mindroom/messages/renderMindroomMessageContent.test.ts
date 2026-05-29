import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';

const toolApprovalCardMock = vi.hoisted(() => vi.fn());
const longTextTextMock = vi.hoisted(() => vi.fn());
const pasteAttachmentContentMock = vi.hoisted(() => vi.fn());
const toolTraceParserOptionsMock = vi.hoisted(() => vi.fn((options: unknown) => options));

vi.mock('../../components/message', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
  MEmote: ({ content, displayName, renderAfterBody, renderBody }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'emote' },
      displayName,
      ' ',
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody
    ),
  MNotice: ({ content, renderAfterBody, renderBody }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'notice' },
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody
    ),
  MText: ({ content, renderAfterBody, renderBody, renderStateSuffix }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'text' },
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderStateSuffix?.(),
      renderAfterBody
    ),
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
}));

vi.mock('./MindroomHtmlBlocks', () => ({
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
  MindroomLongTextText: ({ content, hydrate, kind, renderAfterBody, renderBody }: any) => {
    longTextTextMock({ hydrate, kind });
    return React.createElement(
      'div',
      { 'data-renderer': 'long-text' },
      kind,
      renderBody(content, { body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody?.(content, content)
    );
  },
}));

vi.mock('./MindroomPasteAttachmentContent', () => ({
  MindroomPasteAttachmentContent: ({ attachment }: any) => {
    pasteAttachmentContentMock(attachment);
    return React.createElement('div', { 'data-renderer': 'paste-attachment' }, attachment.fileName);
  },
}));

vi.mock('./StreamingIndicator', () => ({
  renderMindroomStreamingIndicator: () =>
    React.createElement('span', { 'data-renderer': 'streaming' }),
}));

vi.mock('./MindroomThinkingPlaceholder', () => ({
  MindroomThinkingPlaceholder: () =>
    React.createElement('span', { 'data-renderer': 'thinking-placeholder' }, 'Making progress'),
}));

vi.mock('./MindroomMessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
  Html: 'Html',
}));

const messageExtras = {
  version: 1,
  sections: [
    {
      title: 'Evidence',
      content_type: 'text/plain',
      content: 'extra payload',
    },
  ],
};

const renderNode = async (
  options: Partial<
    Parameters<typeof import('./renderMindroomMessageContent').renderMindroomMessageContent>[0]
  >
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
  it('renders the animated MindRoom thinking placeholder for exact active Thinking... messages', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('thinking-placeholder');
    expect(rendered).toContain('Making progress');
    expect(rendered).not.toContain('Thinking...');
    expect(rendered).not.toContain('streaming');

    renderer.unmount();
  });

  it('keeps terminal Thinking... messages on the normal text renderer', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'completed',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('data-renderer');
    expect(rendered).toContain('text');
    expect(rendered).toContain('Thinking...');
    expect(rendered).not.toContain('thinking-placeholder');
    expect(rendered).not.toContain('streaming');

    renderer.unmount();
  });

  it('keeps non-placeholder streaming text on the normal text renderer with the streaming suffix', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'The actual answer has started',
        'io.mindroom.stream_status': 'streaming',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('text');
    expect(rendered).toContain('The actual answer has started');
    expect(rendered).toContain('streaming');
    expect(rendered).not.toContain('thinking-placeholder');

    renderer.unmount();
  });

  it('renders normal text body unchanged when extras are disabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).not.toContain('Evidence');
    expect(rendered).not.toContain('extra payload');

    renderer.unmount();
  });

  it('renders text body and extras when extras are enabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).toContain('Evidence');
    expect(rendered).toContain('extra payload');

    renderer.unmount();
  });

  it('synthesizes safe formatted body for plain text tool markers', async () => {
    toolTraceParserOptionsMock.mockClear();

    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: ['Before <unsafe>', '', '🔧 `run_shell_command` [1]', '', 'After'].join('\n'),
      },
    });

    expect(toolTraceParserOptionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        formatted_body: [
          '<p>Before &lt;unsafe&gt;</p>',
          '<p>🔧 <code>run_shell_command</code> [1]</p>',
          '<p>After</p>',
        ].join(''),
      })
    );

    renderer.unmount();
  });

  it('synthesizes safe formatted body for plain text paste markers', async () => {
    toolTraceParserOptionsMock.mockClear();

    const marker =
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: `Before <unsafe> ${marker} after`,
      },
    });

    expect(toolTraceParserOptionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        formatted_body: [
          '<p>Before &lt;unsafe&gt; ',
          '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
          '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
          '</span>',
          ' after</p>',
        ].join(''),
      })
    );

    renderer.unmount();
  });

  it('ignores malformed extras without affecting body rendering', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Body survives',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 3,
          sections: [messageExtras.sections[0]],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Body survives');
    expect(rendered).not.toContain('Evidence');

    renderer.unmount();
  });

  it('renders v2 html extras when extras are enabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'HTML',
              content_type: 'text/html',
              content:
                '<p><strong>safe html</strong></p><a href="https://example.test">safe link</a>',
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).toContain('HTML');
    expect(rendered).toContain('safe html');
    expect(rendered).toContain('https://example.test');
    expect(rendered).toContain('noreferrer noopener');

    renderer.unmount();
  });

  it('keeps v2 html extras hidden when extras are disabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: false,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'HTML',
              content_type: 'text/html',
              content: '<p>hidden html</p>',
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).not.toContain('hidden html');

    renderer.unmount();
  });

  it('sanitizes malicious v2 html extras without breaking the normal body', async () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const renderer = await renderNode({
      msgType: 'm.notice',
      showMessageExtras: true,
      content: {
        msgtype: 'm.notice',
        body: 'Notice body survives',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'Malicious',
              content_type: 'text/html',
              content: `<p onclick="alert(1)">safe text</p><script>alert(1)</script><iframe src="https://example.test"></iframe><img src="https://example.test/x.png"><a href="${scriptHref}">bad link</a>`,
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Notice body survives');
    expect(rendered).toContain('safe text');
    expect(rendered).toContain('bad link');
    expect(rendered).not.toContain('onclick');
    expect(rendered).not.toContain('script');
    expect(rendered).not.toContain('iframe');
    expect(rendered).not.toContain('img');
    expect(rendered).not.toContain(scriptHref);

    renderer.unmount();
  });

  it('renders extras for MindRoom long-text text paths', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Long text preview',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('long-text');
    expect(rendered).toContain('Long text preview');
    expect(rendered).toContain('Evidence');
    expect(rendered).toContain('extra payload');
    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: true,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('passes long-text hydration preference to deferred long-text renderers', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.text',
      hydrateLongText: false,
      content: {
        msgtype: 'm.text',
        body: 'Long text preview',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: false,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('renders thread summary metadata through the MindRoom summary card', async () => {
    const renderer = await renderNode({
      msgType: 'm.notice',
      showMessageExtras: true,
      content: {
        msgtype: 'm.notice',
        body: 'Summary body',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Rendered summary text',
        },
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('Evidence');
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
      showMessageExtras: true,
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
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('tool-approval');
    expect(rendered).toContain('web_search');
    expect(rendered).not.toContain('Evidence');
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
      hydrate: true,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('renders paste text attachments through an inspectable MindRoom file card', async () => {
    pasteAttachmentContentMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.file',
      content: {
        msgtype: 'm.file',
        body: 'mindroom-paste-a3f19c.txt',
        filename: 'mindroom-paste-a3f19c.txt',
        url: 'mxc://example.org/pasted-text',
        info: {
          mimetype: 'text/plain',
          size: 11,
        },
        'io.mindroom.paste_attachment': {
          version: 1,
          id: 'paste-a3f19c',
          chars: 11,
          file: 'mindroom-paste-a3f19c.txt',
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('paste-attachment');
    expect(rendered).toContain('mindroom-paste-a3f19c.txt');
    expect(pasteAttachmentContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'paste-a3f19c',
        chars: 11,
        fileName: 'mindroom-paste-a3f19c.txt',
        mxcUri: 'mxc://example.org/pasted-text',
      })
    );

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
