// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { createEditor, type Descendant } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownDecorate } from '../../editor/markdownDecorations';
import { createMentionElement, withInlineElements } from '../../editor/utils';
import { getEditedContent, getEditorDocument, isUnchanged } from './MessageEditor';

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
  afterEach(() => vi.restoreAllMocks());

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

  it('saves Markdown after /plain, as its styling in the edit box shows it', () => {
    const editor = editorWith([{ type: 'paragraph', children: [{ text: '/plain **bold**' }] }]);
    expect(getEditedContent(editor, true, 'm.text', ME)).toMatchObject({
      formatted_body: '/plain <strong data-md="**">bold</strong>',
    });
    // The edit box styles without reading commands, as `MessageEditor` passes no `markdownCommands`.
    expect(createMarkdownDecorate()([editor, []])).toContainEqual(
      expect.objectContaining({ bold: true })
    );
  });

  it('styles nothing in a line holding a line break, which is saved split at it', () => {
    const editor = editorWith(
      getEditorDocument(
        {
          msgtype: 'm.text',
          body: 'first\nsecond',
          format: 'org.matrix.custom.html',
          formatted_body: '<strong>first\nsecond</strong>',
        },
        true
      )
    );
    expect(editor.children).toEqual([
      { type: 'paragraph', children: [{ text: '**first\nsecond**' }] },
    ]);
    expect(createMarkdownDecorate()([editor, []])).toEqual([]);
    // Saved as before: the markers stay text, so no HTML is needed.
    expect(getEditedContent(editor, true, 'm.text', ME)).toEqual({
      msgtype: 'm.text',
      body: '**first\nsecond**',
      'm.mentions': {},
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

  it('round-trips room and message mentions serialized as native Universal Links', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const roomMention = createMentionElement('!harbor:example.org', '#Harbor', false, undefined, [
      'example.org',
      'relay.example.org',
    ]);
    const messageMention = createMentionElement(
      '!harbor:example.org',
      'Message in #Harbor',
      false,
      '$entry-1',
      ['example.org']
    );
    const original = getEditedContent(
      editorWith([
        {
          type: 'paragraph',
          children: [
            { text: 'see ' },
            roomMention,
            { text: ' and ' },
            messageMention,
            { text: '' },
          ],
        },
      ]),
      true,
      'm.text',
      ME
    )!;

    expect(original.formatted_body).toContain(
      'https://chat.mindroom.chat/!harbor:example.org?via=example.org&amp;via=relay.example.org'
    );
    expect(original.formatted_body).toContain(
      'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org'
    );

    const reopened = getEditorDocument(original, true);
    expect(reopened).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'see ' }, roomMention, { text: ' and ' }, messageMention],
      },
    ]);
    expect(isUnchanged(original, resave(original)!)).toBe(true);
  });

  it('round-trips room and message mentions serialized on the current web origin', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const aliasMention = createMentionElement(
      '#field-notes:remote.example.org',
      '#field-notes',
      false
    );
    const messageMention = createMentionElement(
      '!harbor:example.org',
      'Message in #Harbor',
      false,
      '$entry-2',
      ['example.org']
    );
    const original = getEditedContent(
      editorWith([
        {
          type: 'paragraph',
          children: [
            { text: 'check ' },
            aliasMention,
            { text: ' and ' },
            messageMention,
            { text: '' },
          ],
        },
      ]),
      true,
      'm.text',
      ME
    )!;

    expect(original.formatted_body).toContain(
      `${window.location.origin}/%23field-notes:remote.example.org`
    );
    expect(original.formatted_body).toContain(
      `${window.location.origin}/!harbor:example.org/$entry-2?via=example.org`
    );

    const reopened = getEditorDocument(original, true);
    expect(reopened).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'check ' }, aliasMention, { text: ' and ' }, messageMention],
      },
    ]);
    expect(isUnchanged(original, resave(original)!)).toBe(true);
  });
});
