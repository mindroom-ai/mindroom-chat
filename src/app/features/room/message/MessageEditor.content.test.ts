import { createEditor, type Descendant } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import { createMentionElement, withInlineElements } from '../../../components/editor/utils';
import { getEditedContent, getEditorDocument, isUnchanged } from './MessageEditor';

// The editor's index brings its style sheets, which unit tests do not compile.
vi.mock('../../../components/editor', async () => ({
  ...(await import('../../../components/editor/utils')),
  ...(await import('../../../components/editor/output')),
  ...(await import('../../../components/editor/input')),
}));

const ME = '@me:example.org';

const editorWith = (document: Descendant[]) => {
  const editor = withInlineElements(createEditor());
  editor.children = document;
  return editor;
};

/** Opens the editor on `content` and saves it as it is. */
const resave = (content: Record<string, unknown>, markdown = true) =>
  getEditedContent(
    editorWith(getEditorDocument(content, markdown)),
    markdown,
    String(content.msgtype),
    ME
  );

describe('the content of an edit', () => {
  it('keeps the message type it is given', () => {
    const editor = editorWith([{ type: 'paragraph', children: [{ text: 'waves again' }] }]);
    expect(getEditedContent(editor, true, 'm.emote', ME)).toEqual({
      msgtype: 'm.emote',
      body: 'waves again',
      'm.mentions': {},
    });
  });

  it('drops HTML that only repeats the body, and keeps HTML that formats it', () => {
    const plain = editorWith([{ type: 'paragraph', children: [{ text: 'just text' }] }]);
    expect(getEditedContent(plain, true, 'm.text', ME)).not.toHaveProperty('formatted_body');

    const bold = editorWith([{ type: 'paragraph', children: [{ text: 'now **bold**' }] }]);
    expect(getEditedContent(bold, true, 'm.text', ME)).toMatchObject({
      format: 'org.matrix.custom.html',
      formatted_body: 'now <strong data-md="**">bold</strong>',
    });
  });

  it('lists the people the new text mentions, never the sender', () => {
    const editor = editorWith([
      {
        type: 'paragraph',
        children: [
          { text: 'cc ' },
          createMentionElement('@ada:example.org', 'Ada', false),
          { text: ' ' },
          createMentionElement(ME, 'Me', true),
          { text: '' },
        ],
      },
    ]);
    expect(getEditedContent(editor, true, 'm.text', ME)?.['m.mentions']).toEqual({
      user_ids: ['@ada:example.org'],
    });
  });

  it('is nothing when the text was cleared', () => {
    const editor = editorWith([{ type: 'paragraph', children: [{ text: '  ' }] }]);
    expect(getEditedContent(editor, true, 'm.text', ME)).toBeUndefined();
  });

  it.each([
    ['a plain message', { msgtype: 'm.text', body: 'Hello there' }],
    ['a message over several lines', { msgtype: 'm.text', body: 'one\ntwo\nthree' }],
    [
      'a message with Markdown formatting',
      {
        msgtype: 'm.text',
        body: 'a **bold** move',
        format: 'org.matrix.custom.html',
        formatted_body: 'a <strong data-md="**">bold</strong> move',
      },
    ],
    [
      'a message that mentions someone',
      {
        msgtype: 'm.text',
        body: 'cc Ada',
        format: 'org.matrix.custom.html',
        formatted_body: 'cc <a href="https://matrix.to/#/@ada:example.org">Ada</a>',
      },
    ],
    [
      'a message with a code block',
      {
        msgtype: 'm.text',
        body: '```\nnpm test\n```',
        format: 'org.matrix.custom.html',
        formatted_body: '<pre data-md="```"><code>npm test\n</code></pre>',
      },
    ],
  ])('saved without a change, %s sends no edit', (_name, content) => {
    const edited = resave(content);
    expect(edited).toBeDefined();
    expect(isUnchanged(content, edited!)).toBe(true);
  });

  it('a changed text is an edit', () => {
    const content = { msgtype: 'm.text', body: 'Hello there' };
    const editor = editorWith(getEditorDocument(content, true));
    editor.children = [{ type: 'paragraph', children: [{ text: 'Hello again' }] }];
    expect(isUnchanged(content, getEditedContent(editor, true, 'm.text', ME)!)).toBe(false);
  });
});
