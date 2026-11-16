import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { MatrixEvent } from 'matrix-js-sdk';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { renderAgentMessageContent } from './renderAgentMessageContent';
import type { ToolMetadataStatus } from '../../matrix/protocol/toolTrace';
import { showToolCalls } from '../../../test/utils/showToolCalls';

// The folded work shows its tool calls once open, so these tests show them.
beforeEach(showToolCalls);

// The tool metadata status the long-text renderer reports: `loading` until the sidecar is read.
const longText = vi.hoisted(() => ({ status: 'unavailable' as ToolMetadataStatus }));

// The real RenderBody and its memo, under an MText that passes the formatted body and renders
// the extras after it, as MText does.
vi.mock('./MsgTypeRenderers', async () => {
  return {
    MEmote: () => null,
    MNotice: () => null,
    MText: ({ content, renderBody, renderAfterBody }: any) =>
      React.createElement(
        'div',
        null,
        renderBody({ body: content.body, customBody: content.formatted_body }),
        renderAfterBody
      ),
  };
});
vi.mock('./RenderBody', async () => {
  const { RenderBody } = await import('./RenderBody');
  return {
    RenderBody,
  };
});
vi.mock('./BrokenContent', async () => {
  return {
    BrokenContent: () => null,
  };
});

vi.mock('./FallbackContent', () => ({ MessageEmptyContent: () => null }));

vi.mock('../html/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));

vi.mock('../agent-run/StreamingIndicator', () => ({ renderStreamingIndicator: () => null }));
vi.mock('../thread-summary/ThreadSummaryCard', () => ({ ThreadSummaryCard: () => null }));
vi.mock('../../approvals/ToolApprovalCard', () => ({ ToolApprovalCard: () => null }));
vi.mock('./PasteAttachmentContent', () => ({ PasteAttachmentContent: () => null }));
vi.mock('../agent-run/ThinkingPlaceholder', () => ({ ThinkingPlaceholder: () => null }));
vi.mock('./LongTextText', () => ({
  LongTextKind: { Text: 'text', Emote: 'emote', Notice: 'notice' },
  LongTextText: ({ content, renderBody }: any) =>
    renderBody(
      content,
      { body: content.body, customBody: content.formatted_body },
      longText.status
    ),
}));

vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
}));

vi.mock('../agent-run/Reasoning.css', () => ({}));
vi.mock('../html/HtmlBlocks.css', () => ({
  Block: 'Block',
  BlockBody: 'BlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'BlockHeader',
  BlockHeaderMeta: 'BlockHeaderMeta',
  PasteMarkerBadge: 'PasteMarkerBadge',
  PasteMarkerBadgeMeta: 'PasteMarkerBadgeMeta',
}));

vi.mock('../../ui/PendingSendIndicator.css', () => ({ Container: 'PendingSendIndicator' }));

vi.mock('../agent-run/TranscribingPlaceholder.css', () => ({
  Placeholder: 'TranscribingPlaceholder',
  Text: 'TranscribingText',
  Wave: 'TranscribingWave',
  WaveBar: 'TranscribingWaveBar',
}));

vi.mock('../MessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
  Html: 'Html',
}));

const htmlReactParserOptions: HTMLReactParserOptions = {};
const linkifyOpts = {};

const marker = (name: string, index: number) => `<p>🔧 <code>${name}</code> [${index}]</p>`;

const toolTrace = (...toolNames: string[]) => ({
  version: 2,
  events: toolNames.map((name) => ({ type: 'tool_call_completed', tool_name: name })),
});

/** A reply that searched, read a file, then answered. */
const reply = (
  status: string | undefined,
  html = `<p>Let me look.</p>${marker('web_search', 1)}<p>Now the file.</p>${marker(
    'read_file',
    2
  )}<p>The answer.</p>`
): Record<string, unknown> => ({
  msgtype: 'm.text',
  body: 'Let me look. Now the file. The answer.',
  format: 'org.matrix.custom.html',
  formatted_body: html,
  'io.mindroom.tool_trace': toolTrace('web_search', 'read_file'),
  ...(status === undefined ? {} : { 'io.mindroom.ai_run': { version: 1, status } }),
});

// Sent, then last edited 2 min 13 s later.
const mEvent = new MatrixEvent({
  event_id: '$reply',
  type: 'm.room.message',
  room_id: '!room:example.org',
  sender: '@agent:example.org',
  origin_server_ts: 1_000_000,
  content: {},
});
vi.spyOn(mEvent, 'replacingEvent').mockReturnValue(
  new MatrixEvent({ origin_server_ts: 1_133_000 })
);

let renderer: ReactTestRenderer | undefined;
const render = (content: Record<string, unknown>, fromMindroomAgent = true) =>
  act(() => {
    const tree = (
      <ClientConfigProvider value={{}}>
        {renderAgentMessageContent({
          mEvent,
          eventId: '$reply',
          fromMindroomAgent,
          displayName: 'Agent',
          msgType: 'm.text',
          content,
          htmlReactParserOptions,
          linkifyOpts,
        })}
      </ClientConfigProvider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
const text = () => JSON.stringify(renderer?.toJSON());
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
const workedRow = () =>
  renderer!.root.find((node) => node.type === 'button' && textOf(node).startsWith('Worked'));
const toolCalls = () =>
  renderer?.root
    .findAll((node) => node.props.className === 'activity-detail')
    .map((node) => node.children.join(''));

describe('finished agent work', () => {
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    longText.status = 'unavailable';
  });

  it('folds the work of a finished reply and keeps its answer', () => {
    render(reply('completed'));

    expect(text()).toContain('Worked for 2m 13s');
    expect(text()).toContain('The answer.');
    expect(text()).not.toContain('Let me look.');
    expect(text()).not.toContain('Now the file.');
    expect(toolCalls()).toEqual([]);
  });

  it('shows the work in place when the row is clicked', () => {
    render(reply('cached'));
    act(() => {
      workedRow().props.onClick();
    });

    expect(workedRow().props['aria-expanded']).toBe(true);
    expect(text()).toContain('Let me look.');
    expect(text()).toContain('Now the file.');
    expect(toolCalls()).toEqual(['web_search', 'read_file']);
    expect(text()).toContain('The answer.');
  });

  it.each([[undefined], ['streaming'], ['error'], ['cancelled']])(
    'does not fold a reply whose run status is %s',
    (status) => {
      render(reply(status));

      expect(text()).not.toContain('Worked');
      expect(text()).toContain('Let me look.');
      expect(toolCalls()).toEqual(['web_search', 'read_file']);
    }
  );

  it('does not fold a reply without tool calls', () => {
    render(reply('completed', '<p>Just an answer.</p>'));

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Just an answer.');
  });

  it('does not fold a reply that ends in a tool call', () => {
    render(reply('completed', `<p>Let me look.</p>${marker('web_search', 1)}`));

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
  });

  it('does not fold a message from someone other than a MindRoom agent', () => {
    render(reply('completed'), false);

    expect(text()).not.toContain('Worked');
    expect(text()).toContain('Let me look.');
  });

  it('folds a reply once it finishes on screen', () => {
    render(reply('streaming'));
    expect(text()).not.toContain('Worked');

    render(reply('completed'));
    expect(text()).toContain('Worked for 2m 13s');
    expect(text()).not.toContain('Let me look.');
  });

  describe('a long reply in a sidecar', () => {
    const longReply = (status: string) => ({
      ...reply(status),
      url: 'mxc://example.org/long-text',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    });

    it('folds once the sidecar is read', () => {
      render(longReply('completed'));

      expect(text()).toContain('Worked for 2m 13s');
      expect(text()).toContain('The answer.');
      expect(text()).not.toContain('Let me look.');
    });

    it('does not fold the preview while the sidecar loads', () => {
      longText.status = 'loading';
      render(longReply('completed'));

      expect(text()).not.toContain('Worked');
      expect(text()).toContain('Let me look.');
    });
  });
});
