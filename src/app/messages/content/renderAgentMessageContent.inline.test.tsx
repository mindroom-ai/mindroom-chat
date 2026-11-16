// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { renderAgentMessageContent } from './renderAgentMessageContent';

// The real MsgTypeRenderers and RenderBody: the body sits in the line of its prefix and suffix.
vi.mock('./FallbackContent', () => ({
  MessageEditedContent: () => React.createElement('span', null, '(edited)'),
  MessageEmptyContent: () => null,
}));
vi.mock('./BrokenContent', () => ({ BrokenContent: () => null }));
vi.mock('./VoiceAudioContent', () => ({ VoiceAudioContent: () => null }));
vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({ useGlassHighlight: () => undefined }));
vi.mock('./FileRow.css', () => ({}));
vi.mock('../layout/layout.css', () => ({ MessageTextBody: () => 'MessageTextBody' }));
vi.mock('../html/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));
vi.mock('../agent-run/StreamingIndicator', () => ({
  renderStreamingIndicator: () => React.createElement('span', null, '...'),
}));
vi.mock('../agent-run/Reasoning.css', () => ({}));
vi.mock('../agent-run/FinishedWorkFold.css', () => ({}));
vi.mock('../html/HtmlBlocks.css', () => ({}));
vi.mock('../../ui/PendingSendIndicator.css', () => ({}));
vi.mock('../MessageExtras.css.ts', () => ({}));

const mEvent = new MatrixEvent({
  event_id: '$reply',
  type: 'm.room.message',
  room_id: '!room:example.org',
  sender: '@agent:example.org',
  origin_server_ts: 1_000_000,
  content: {},
});

let renderer: ReactTestRenderer | undefined;
const render = (msgType: string, content: Record<string, unknown>, edited?: boolean) =>
  act(() => {
    renderer = create(
      <ClientConfigProvider value={{}}>
        {renderAgentMessageContent({
          mEvent,
          eventId: '$reply',
          fromMindroomAgent: true,
          displayName: 'Agent',
          msgType,
          edited,
          content: { msgtype: msgType, ...content },
          htmlReactParserOptions: {},
          linkifyOpts: {},
        })}
      </ClientConfigProvider>
    );
  });

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

/** The body box, and any block element inside it that would break its line. */
const blocksInBody = () => {
  const box = renderer!.root.find(
    (node) => typeof node.type === 'string' && node.props['data-body-direction'] !== undefined
  );
  const blocks = box
    .findAll((node) => node !== box && (node.type === 'div' || node.type === 'p'))
    .map((node) => node.type);
  return { text: textOf(box), blocks };
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('an agent body in the line of its prefix and suffix', () => {
  it('keeps an emote inline after the sender name', () => {
    render('m.emote', { body: 'waves' });

    const { text, blocks } = blocksInBody();
    expect(text).toBe('* Agent waves');
    expect(blocks).toEqual([]);
  });

  it('keeps an inline body before its edited mark', () => {
    render('m.text', { body: 'Done.' }, true);

    const { text, blocks } = blocksInBody();
    expect(text).toBe('Done.(edited)');
    expect(blocks).toEqual([]);
  });

  it('keeps an inline streaming body before its dots', () => {
    render('m.text', {
      body: 'Working',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });

    const { text, blocks } = blocksInBody();
    expect(text).toBe('Working...');
    expect(blocks).toEqual([]);
  });
});
