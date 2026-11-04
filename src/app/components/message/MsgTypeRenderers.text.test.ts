import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import { MText } from './MsgTypeRenderers';

vi.mock('./content', () => ({
  BrokenContent: () => null,
  MessageBadEncryptedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));
vi.mock('./content/VoiceAudioContent', () => ({ VoiceAudioContent: () => null }));
vi.mock('../glass/liquid/useLiquidGlass', () => ({ useGlassHighlight: () => undefined }));
vi.mock('./FileRow.css', () => ({}));

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
