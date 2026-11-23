// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { createEditor, type Descendant } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownDecorate } from '../../editor/markdownDecorations';
import { createMentionElement, getMentions, withInlineElements } from '../../editor/utils';
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

const HTML = 'org.matrix.custom.html';

/** A sent message whose text is `html`. */
const sentHtml = (body: string, html: string) => ({
  msgtype: 'm.text',
  body,
  format: HTML,
  formatted_body: html,
});

/**
 * An edit of other text: `content` opened, its first word changed from `from` to `to`, and saved.
 * Also the people the edit box mentions then.
 */
const saveWithFirstWord = (
  content: Record<string, unknown>,
  markdown: boolean,
  from: string,
  to: string
) => {
  const opened = JSON.stringify(getEditorDocument(content, markdown));
  const editor = editorWith(
    JSON.parse(opened.replace(`"text":"${from} `, `"text":"${to} `)) as Descendant[]
  );
  return {
    mentioned: getMentions(editor, ME).users,
    saved: getEditedContent(editor, markdown, 'm.text', ME)!,
  };
};

/** `document` with its mention pills deleted. */
const withoutMentions = (document: Descendant[]): Descendant[] =>
  document.map((block) =>
    'children' in block
      ? ({
          ...block,
          children: block.children.filter(
            (child) => !('type' in child && child.type === 'mention')
          ),
        } as Descendant)
      : block
  );

/** What a message typed as `source` sends, with Markdown on. */
const typedMarkdown = (source: string) =>
  getEditedContent(
    editorWith([{ type: 'paragraph', children: [{ text: source }] }]),
    true,
    'm.text',
    ME
  )!;

const hasMention = (document: Descendant[]): boolean =>
  JSON.stringify(document).includes('"type":"mention"');

/** What a message that mentions the event sends, composed where the test runs. */
const composedEventMention = () =>
  getEditedContent(
    editorWith([
      {
        type: 'paragraph',
        children: [
          { text: 'see ' },
          createMentionElement('!harbor:example.org', 'Message in #Harbor', false, '$entry-1', [
            'example.org',
          ]),
          { text: '' },
        ],
      },
    ]),
    true,
    'm.text',
    ME
  )!;

describe('the content of an edit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

    // Read back, each mention keeps the link it was sent with.
    const reopened = getEditorDocument(original, true);
    expect(reopened).toEqual([
      {
        type: 'paragraph',
        children: [
          { text: 'see ' },
          {
            ...roomMention,
            href: 'https://chat.mindroom.chat/!harbor:example.org?via=example.org&via=relay.example.org',
          },
          { text: ' and ' },
          {
            ...messageMention,
            href: 'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org',
          },
        ],
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
        children: [
          { text: 'check ' },
          {
            ...aliasMention,
            href: `${window.location.origin}/%23field-notes:remote.example.org`,
          },
          { text: ' and ' },
          {
            ...messageMention,
            href: `${window.location.origin}/!harbor:example.org/$entry-2?via=example.org`,
          },
        ],
      },
    ]);
    expect(isUnchanged(original, resave(original)!)).toBe(true);
  });

  it('sends the Universal Link of a mention again as it was, on another web origin', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.stubGlobal('location', {
      protocol: 'https:',
      origin: 'https://team.example',
      href: 'https://team.example/home/',
    });
    const href =
      'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org&via=relay.example.org';
    const original = sentHtml(
      'see Message in #Harbor',
      `see <a href="${href.replace(/&/g, '&amp;')}">Message in #Harbor</a>`
    );

    expect(getEditorDocument(original, true)).toEqual([
      {
        type: 'paragraph',
        children: [
          { text: 'see ' },
          createMentionElement(
            '!harbor:example.org',
            'Message in #Harbor',
            false,
            '$entry-1',
            ['example.org', 'relay.example.org'],
            href
          ),
        ],
      },
    ]);
    const saved = resave(original)!;
    expect(saved.formatted_body).toBe(original.formatted_body);
    expect(isUnchanged(original, saved)).toBe(true);

    // A mention made here links to this origin, as before.
    expect(composedEventMention().formatted_body).toBe(
      'see <a href="https://team.example/!harbor:example.org/$entry-1?via=example.org">Message in #Harbor</a>'
    );
  });

  it('sends the older matrix.to links of mentions again as they were, in the native app', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const eventHref = 'https://matrix.to/#/!harbor:example.org/$entry-1?via=example.org';
    const escapedRoomHref = 'https://matrix.to/#/%21harbor%3Aexample.org?via=example.org';
    const userHref = 'https://matrix.to/#/@ada:example.org';
    const original = sentHtml(
      'see Message in #Harbor in #Harbor, Ada',
      `see <a href="${eventHref}">Message in #Harbor</a> in <a href="${escapedRoomHref}">#Harbor</a>, <a href="${userHref}">Ada</a>`
    );

    expect(getEditorDocument(original, true)).toEqual([
      {
        type: 'paragraph',
        children: [
          { text: 'see ' },
          createMentionElement(
            '!harbor:example.org',
            'Message in #Harbor',
            false,
            '$entry-1',
            ['example.org'],
            eventHref
          ),
          { text: ' in ' },
          createMentionElement(
            '!harbor:example.org',
            '#Harbor',
            false,
            undefined,
            ['example.org'],
            escapedRoomHref
          ),
          { text: ', ' },
          createMentionElement('@ada:example.org', 'Ada', false, undefined, undefined, userHref),
        ],
      },
    ]);
    const saved = resave(original)!;
    expect(saved.formatted_body).toBe(original.formatted_body);
    expect(saved['m.mentions']).toEqual({ user_ids: ['@ada:example.org'] });
    expect(isUnchanged(original, saved)).toBe(true);

    // A mention made here is a Universal Link, as before.
    expect(composedEventMention().formatted_body).toBe(
      'see <a href="https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org">Message in #Harbor</a>'
    );
  });

  it.each([
    [
      'a spoiler to an event',
      'see [||ending||](https://chat.mindroom.chat/!room:example.org/$event)',
      ' data-mx-spoiler>ending</span></a>',
    ],
    [
      'bold text to an event',
      'see [**bold**](https://chat.mindroom.chat/!room:example.org/$event)',
      '>bold</strong></a>',
    ],
    [
      'a name to a user',
      'see [Alice](https://chat.mindroom.chat/@alice:example.org)',
      '>Alice</a>',
    ],
    [
      'a bold name to a user on matrix.to',
      'see [**Alice**](https://matrix.to/#/@alice:example.org)',
      '>Alice</strong></a>',
    ],
  ])(
    'saved without a change, a typed Markdown link from %s stays that link',
    (_what, source, label) => {
      const original = typedMarkdown(source);
      expect(original.body).toBe(source);
      expect(original.formatted_body).toContain('<a data-md href="https://');
      expect(original.formatted_body).toContain(label);
      expect(original['m.mentions']).toEqual({});

      // No pill, which would show the label without its formatting and notify the user it names.
      [true, false].forEach((markdown) => {
        const reopened = getEditorDocument(original, markdown);
        expect(hasMention(reopened)).toBe(false);
        expect(getMentions(editorWith(reopened), ME)).toEqual({ users: new Set(), room: false });
      });
      const saved = resave(original)!;
      expect(saved).toEqual(original);
      expect(isUnchanged(original, saved)).toBe(true);
    }
  );

  it.each([
    [
      'https://chat.mindroom.chat/!room:example.org/$event',
      '<span data-mx-spoiler>ending</span>',
      ' data-mx-spoiler>ending</span></a>',
    ],
    [
      'https://chat.mindroom.chat/!room:example.org/$event',
      '<strong>ending</strong>',
      '>ending</strong></a>',
    ],
    // A pill would show what the spoiler hides, also for a matrix.to link.
    [
      'https://matrix.to/#/!room:example.org',
      '<span data-mx-spoiler>ending</span>',
      ' data-mx-spoiler>ending</span></a>',
    ],
  ])('keeps an anchor of another client to %s around %s a link', (href, label, kept) => {
    const original = sentHtml('see ending', `see <a href="${href}">${label}</a>`);

    expect(hasMention(getEditorDocument(original, true))).toBe(false);
    expect(hasMention(getEditorDocument(original, false))).toBe(false);
    // Edited as Markdown, the link keeps the formatting of its label.
    const saved = resave(original)!;
    expect(saved.formatted_body).toContain(`href="${href}">`);
    expect(saved.formatted_body).toContain(kept);
    expect(saved['m.mentions']).toEqual({});
  });

  it.each([true, false])(
    'an edit of other text mentions nobody for a plain link to a user in the app (Markdown %s)',
    (markdown) => {
      const href = 'https://chat.mindroom.chat/@alice:example.org';
      const original = {
        ...sentHtml('See Alice', `See <a href="${href}">Alice</a>`),
        'm.mentions': {},
      };

      const first = saveWithFirstWord(original, markdown, 'See', 'Ask');
      expect(first.mentioned.has('@alice:example.org')).toBe(false);
      expect(first.saved.body).toMatch(/^Ask /);
      expect(first.saved.formatted_body).toContain(`href="${href}">Alice</a>`);
      expect(first.saved['m.mentions']).toEqual({});

      // Edited again as rich text, whose first save left an anchor without any mark of a link.
      const second = saveWithFirstWord(first.saved, false, 'Ask', 'See');
      expect(second.mentioned.has('@alice:example.org')).toBe(false);
      expect(second.saved.body).toMatch(/^See /);
      expect(second.saved.formatted_body).toContain(`href="${href}">Alice</a>`);
      expect(second.saved['m.mentions']).toEqual({});
    }
  );

  it.each([true, false])(
    'an edit of other text keeps a matrix.to mention whose name is bold (Markdown %s)',
    (markdown) => {
      const href = 'https://matrix.to/#/@alice:example.org';
      const original = {
        ...sentHtml('See Alice', `See <a href="${href}"><strong>Alice</strong></a>`),
        'm.mentions': { user_ids: ['@alice:example.org'] },
      };
      const reopened = getEditorDocument(original, markdown);
      expect(reopened).toEqual([
        {
          type: 'paragraph',
          children: [
            { text: 'See ' },
            createMentionElement('@alice:example.org', 'Alice', false, undefined, undefined, href),
          ],
        },
      ]);

      const edited = saveWithFirstWord(original, markdown, 'See', 'Ask');
      expect(edited.mentioned).toEqual(new Set(['@alice:example.org']));
      expect(edited.saved.formatted_body).toBe(`Ask <a href="${href}">Alice</a>`);
      expect(edited.saved['m.mentions']).toEqual({ user_ids: ['@alice:example.org'] });

      // With the pill deleted, the edit mentions nobody.
      const deleted = editorWith(withoutMentions(reopened));
      expect(getMentions(deleted, ME).users.size).toBe(0);
      expect(getEditedContent(deleted, markdown, 'm.text', ME)!['m.mentions']).toEqual({});
    }
  );

  it.each(['https://chat.mindroom.chat/@room', 'https://matrix.to/#/@room'])(
    'keeps a link to %s a link, which notifies nobody',
    (href) => {
      const original = sentHtml('see Room', `see <a href="${href}">Room</a>`);

      expect(getEditorDocument(original, false)).toEqual([
        {
          type: 'paragraph',
          children: [{ text: 'see ' }, { type: 'link', href, children: [{ text: 'Room' }] }],
        },
      ]);
      [true, false].forEach((markdown) => {
        const saved = resave(original, markdown)!;
        expect(saved['m.mentions']).toEqual({});
        expect(saved.body).toContain('Room');
        expect(saved.formatted_body).toContain(`href="${href}">Room</a>`);
      });
    }
  );
});
