import { MsgType } from 'matrix-js-sdk';
import { createEditor, type Descendant } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import { createMentionElement, withInlineElements } from '../../components/editor/utils';
import { composeTextMessage } from './composeTextMessage';

// The editor's index brings its style sheets, which unit tests do not compile.
vi.mock('../../components/editor', async () => ({
  ...(await import('../../components/editor/utils')),
  ...(await import('../../components/editor/output')),
}));

const ME = '@me:example.org';

/** A real Slate editor holding `document`. */
const editorWith = (document: Descendant[]) => {
  const editor = withInlineElements(createEditor());
  editor.children = document;
  return editor;
};

const line = (...children: unknown[]) => ({ type: 'paragraph', children }) as Descendant;

const compose = (document: Descendant[], markdown = true) =>
  composeTextMessage(editorWith(document), markdown, ME);

describe('composeTextMessage', () => {
  it('sends plain text as m.text without HTML that only repeats it', () => {
    expect(compose([line({ text: 'Hello there' })])).toEqual({
      msgtype: MsgType.Text,
      body: 'Hello there',
      'm.mentions': {},
    });
  });

  it('keeps HTML when Markdown formats the text', () => {
    expect(compose([line({ text: 'a **bold** move' })])).toMatchObject({
      body: 'a **bold** move',
      format: 'org.matrix.custom.html',
      formatted_body: 'a <strong data-md="**">bold</strong> move',
    });
  });

  it('sends nothing when only blank space is left', () => {
    expect(compose([line({ text: '   ' })])).toBeUndefined();
  });

  it('lists the mentioned users, not the sender, and @room', () => {
    const content = compose([
      line(
        { text: 'Ask ' },
        createMentionElement('@ada:example.org', 'Ada', false),
        { text: ' and ' },
        createMentionElement(ME, 'Me', true),
        { text: ' ' },
        createMentionElement('@room', '@room', true),
        { text: '' }
      ),
    ]);

    expect(content?.['m.mentions']).toEqual({ user_ids: ['@ada:example.org'], room: true });
    expect(content?.formatted_body).toContain('https://matrix.to/#/@ada:example.org');
  });

  it('sends /me as an emote without the command', () => {
    expect(compose([line({ text: '/me waves' })])).toEqual({
      msgtype: MsgType.Emote,
      body: 'waves',
      'm.mentions': {},
    });
  });

  it('sends /notice as a notice, and keeps the formatting of the rest', () => {
    expect(compose([line({ text: '/notice the build is **green**' })])).toEqual({
      msgtype: MsgType.Notice,
      body: 'the build is **green**',
      format: 'org.matrix.custom.html',
      formatted_body: 'the build is <strong data-md="**">green</strong>',
      'm.mentions': {},
    });
  });

  it('takes the command off a line of its own', () => {
    expect(compose([line({ text: '/me' }), line({ text: 'stretches' })])).toMatchObject({
      msgtype: MsgType.Emote,
      body: 'stretches',
    });
  });

  it('sends nothing for a command without text', () => {
    expect(compose([line({ text: '/me   ' })])).toBeUndefined();
  });

  it.each(['/menu at noon', 'say /me waves', ' /me waves'])(
    'sends "%s" as written',
    (text) => {
      expect(compose([line({ text })])).toMatchObject({
        msgtype: MsgType.Text,
        body: text.trim(),
      });
    }
  );

  it('sends a command inside a code block as written', () => {
    const content = compose([
      {
        type: 'code-block',
        children: [{ type: 'code-line', children: [{ text: '/me waves' }] }],
      } as Descendant,
    ]);
    expect(content?.msgtype).toBe(MsgType.Text);
  });
});
