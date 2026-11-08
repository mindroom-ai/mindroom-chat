import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import { MEmote, MLocation, MNotice, MText } from './MsgTypeRenderers';

vi.mock('./FallbackContent', () => ({
  MessageBadEncryptedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));
vi.mock('./BrokenContent', () => ({
  BrokenContent: () => null,
}));
vi.mock('./VoiceAudioContent', () => ({ VoiceAudioContent: () => null }));
vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({ useGlassHighlight: () => undefined }));
vi.mock('./FileRow.css', () => ({}));
// The body box, with the size variant it was given readable from the test renderer.
vi.mock('../layout/layout', () => ({
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

describe('notices', () => {
  it('read quieter than text, and a notice that becomes text keeps its body and its state', () => {
    // An agent reply streams as a notice and its last edit makes it text.
    expect(MNotice).toBe(MText);
    const Body = ({ body }: { body: string }) => {
      const [opened] = React.useState(() => ({ body }));
      return React.createElement('span', { 'data-first-body': opened.body }, body);
    };
    const message = (msgtype: MsgType, body: string) =>
      React.createElement(msgtype === MsgType.Notice ? MNotice : MText, {
        content: { msgtype, body },
        renderBody: ({ body: text }) => React.createElement(Body, { body: text }),
      });
    const priority = (renderer: ReturnType<typeof create>) =>
      renderer.root.find(
        (node) => typeof node.type === 'string' && node.props['data-body-direction'] !== undefined
      ).props.priority;
    const renderer = create(message(MsgType.Notice, 'Working on it'));
    expect(priority(renderer)).toBe('300');

    renderer.update(message(MsgType.Text, 'Done'));
    expect(priority(renderer)).toBe('400');
    expect(renderer.root.findByType('span').props['data-first-body']).toBe('Working on it');
    renderer.unmount();
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

describe('location', () => {
  it('shows the direction controls of its description as code points', () => {
    // Applied, the right-to-left override would show `B4 tsae` as `east 4B`.
    const renderer = create(
      React.createElement(MLocation, {
        content: {
          msgtype: MsgType.Location,
          body: 'Meet at gate \u202eB4 tsae\u202c by the lifts',
          geo_uri: 'geo:52.3702,4.8952',
        },
      })
    );
    const text = JSON.stringify(renderer.toJSON());
    renderer.unmount();
    expect(text).toContain('Meet at gate <U+202E>B4 tsae<U+202C> by the lifts');
    expect(text).not.toMatch(/[\u202a-\u202e]/);
  });
});
