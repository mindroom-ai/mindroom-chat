import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import { MEmote, MText } from './MsgTypeRenderers';

vi.mock('.', () => ({
  BrokenContent: () => null,
  MessageBadEncryptedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));
vi.mock('./VoiceAudioContent', () => ({ VoiceAudioContent: () => null }));
vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({ useGlassHighlight: () => undefined }));
vi.mock('./FileRow.css', () => ({}));
// The body box, with the size variant it was given readable from the test renderer.
vi.mock('../layout', () => ({
  MessageTextBody: ({ jumboEmoji, ...props }: { jumboEmoji?: boolean }) =>
    React.createElement('div', { ...props, 'data-jumbo-emoji': jumboEmoji === true }),
}));

/** The white-space of the box that holds the rendered body. */
const bodyWhiteSpace = (content: Record<string, unknown>): unknown => {
  const renderer = create(
    React.createElement(MText, {
      content: { msgtype: MsgType.Text, ...content },
      renderBody: ({ body, customBody }) => customBody ?? body,
    })
  );
  const box = renderer.root.find(
    (node) => typeof node.type === 'string' && node.props.style?.whiteSpace !== undefined
  );
  const { whiteSpace } = box.props.style;
  renderer.unmount();
  return whiteSpace;
};

describe('text message body', () => {
  it('keeps the line breaks of a plain body', () => {
    expect(bodyWhiteSpace({ body: 'one\ntwo' })).toBe('pre-wrap');
  });

  it('lays out an HTML body by its markup, so newlines between blocks add no blank lines', () => {
    expect(
      bodyWhiteSpace({
        body: 'one\n\n- two',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>one</p>\n<ul>\n<li>two</li>\n</ul>\n',
      })
    ).toBe('normal');
  });

  it('treats an empty HTML body as plain text', () => {
    expect(
      bodyWhiteSpace({ body: 'one\ntwo', format: 'org.matrix.custom.html', formatted_body: '' })
    ).toBe('pre-wrap');
  });
});

/** Whether the body box of a text message (or an emote, with `emote`) shows its emoji large. */
const showsJumboEmoji = (content: Record<string, unknown>, emote = false): unknown => {
  const props = {
    content: { msgtype: emote ? MsgType.Emote : MsgType.Text, ...content },
    renderBody: ({ body, customBody }: { body: string; customBody?: string }) => customBody ?? body,
  };
  const renderer = create(
    emote
      ? React.createElement(MEmote, { ...props, displayName: 'Alice' })
      : React.createElement(MText, props)
  );
  const box = renderer.root.find(
    (node) => typeof node.type === 'string' && node.props['data-jumbo-emoji'] !== undefined
  );
  const jumbo = box.props['data-jumbo-emoji'];
  renderer.unmount();
  return jumbo;
};

describe('emoji-only text message', () => {
  it('shows a body of only emoji large', () => {
    expect(showsJumboEmoji({ body: '🎉' })).toBe(true);
    expect(showsJumboEmoji({ body: '👍 😀' })).toBe(true);
  });

  it('keeps emoji in a sentence at the size of the text', () => {
    expect(showsJumboEmoji({ body: 'Shipped 🎉' })).toBe(false);
  });

  it('shows custom emoji large when the HTML body draws them as images', () => {
    expect(
      showsJumboEmoji({
        body: ':party:',
        format: 'org.matrix.custom.html',
        formatted_body: '<img data-mx-emoticon src="mxc://example.org/party" alt=":party:">',
      })
    ).toBe(true);
    expect(showsJumboEmoji({ body: ':party:' })).toBe(false);
  });

  it('keeps an emote at the size of the text, since its sender name leads the line', () => {
    expect(showsJumboEmoji({ body: '🎉' }, true)).toBe(false);
  });
});
