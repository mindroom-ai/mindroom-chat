import { MsgType, RelationType } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { trustAgentsOfViewer } from '../matrix/protocol/untrustedContent';
import { MessageEvent } from '../matrix/types/room';
import {
  getSearchResultBodySnippet,
  getSearchResultEffectiveContent,
  getSearchResultLightweightCustomBody,
  getSearchResultLightweightFormattedBody,
  getSearchResultPreviewText,
  isSearchResultEdited,
  shouldUseLightweightSearchResultBody,
} from './searchResultPreview';

describe('getSearchResultPreviewText', () => {
  it('uses replacement content for edited search results', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
          'm.new_content': {
            body: 'new body',
            msgtype: MsgType.Text,
          },
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$target',
          },
        },
      } as never)
    ).toBe('new body');
  });

  it('labels media messages tersely', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'report.pdf',
          msgtype: MsgType.File,
        },
      } as never)
    ).toBe('File: report.pdf');
  });

  it('returns a stable preview for redacted messages', () => {
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'hello',
          msgtype: MsgType.Text,
        },
        unsigned: {
          redacted_because: {
            content: {},
          },
        },
      } as never)
    ).toBe('Message was redacted.');
  });

  it('returns bundled unsigned replacement content for text renderers', () => {
    expect(
      getSearchResultEffectiveContent({
        type: MessageEvent.RoomMessage,
        content: {
          body: 'old body',
          msgtype: MsgType.Text,
        },
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              content: {
                body: 'wrapper body',
                msgtype: MsgType.Text,
                'm.new_content': {
                  body: 'final body',
                  msgtype: MsgType.Text,
                },
              },
            },
          },
        },
      } as never)
    ).toMatchObject({
      body: 'final body',
      msgtype: MsgType.Text,
    });
  });

  // Only a message's sender can edit it (Matrix specification, "Event replacements").
  const withBundledEditBy = (editSender: string) =>
    ({
      type: MessageEvent.RoomMessage,
      sender: '@author:example.org',
      content: { body: 'The forklift is charged.', msgtype: MsgType.Text },
      unsigned: {
        'm.relations': {
          [RelationType.Replace]: {
            sender: editSender,
            content: {
              body: '* The forklift is broken.',
              msgtype: MsgType.Text,
              'm.new_content': { body: 'The forklift is broken.', msgtype: MsgType.Text },
            },
          },
        },
      },
    } as never);

  it('ignores an edit another sender bundled with the message', () => {
    const event = withBundledEditBy('@other:example.org');

    expect(getSearchResultPreviewText(event)).toBe('The forklift is charged.');
    expect(isSearchResultEdited(event)).toBe(false);
  });

  it('shows the edit the message’s sender bundled with it', () => {
    const event = withBundledEditBy('@author:example.org');

    expect(getSearchResultPreviewText(event)).toBe('The forklift is broken.');
    expect(isSearchResultEdited(event)).toBe(true);
  });

  it('truncates oversized preview bodies', () => {
    const hugeBody = `prefix ${'x'.repeat(3000)} suffix`;

    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.File,
        },
      } as never)
    ).toMatch(/^File: /);
    expect(
      getSearchResultPreviewText({
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.File,
        },
      } as never).length
    ).toBeLessThan(1700);
  });

  it('centers oversized previews around the first highlight', () => {
    const hugeBody = `${'a'.repeat(2000)} ISSUE-024 ${'b'.repeat(2000)}`;

    const preview = getSearchResultPreviewText(
      {
        type: MessageEvent.RoomMessage,
        content: {
          body: hugeBody,
          msgtype: MsgType.Text,
        },
      } as never,
      ['ISSUE-024']
    );

    expect(preview).toContain('ISSUE-024');
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('a search hit of a reply with tool calls', () => {
  const AGENT = '@mindroom_helper:example.org';
  const calls = [{ type: 'tool_call_completed', tool_name: 'shell' }];
  const built = {
    msgtype: 'm.text',
    body: 'The walrus plan.\n\n🔧 `shell` [1]\n\nDone.',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>The walrus plan.</p>\n<p>🔧 <code>shell</code> [1]</p>\n<p>Done.</p>\n',
    'io.mindroom.tool_trace': { version: 2, events: calls },
  };
  // As Matrix holds the reply: its marker out of its text, the call's place on its entry.
  const held = {
    ...built,
    body: 'The walrus plan.\n\nDone.',
    formatted_body: '<p>The walrus plan.</p>\n<p>Done.</p>\n',
    'io.mindroom.tool_trace': { version: 3, events: [{ ...calls[0], body_line: 2, at: 1 }] },
  };
  const hit = (sender: string, content: Record<string, unknown>) =>
    ({ type: MessageEvent.RoomMessage, sender, content } as never);

  beforeAll(() => trustAgentsOfViewer('@reader:example.org'));

  it("previews an agent's reply as it was built, its calls where they stood", () => {
    expect(getSearchResultPreviewText(hit(AGENT, held))).toBe(
      getSearchResultPreviewText(hit(AGENT, built))
    );
    expect(getSearchResultPreviewText(hit(AGENT, held))).toContain('plan. 🔧 `shell` [1] Done.');
    const { body, formatted_body: html } = getSearchResultEffectiveContent(hit(AGENT, held));
    expect([body, html]).toEqual([built.body, built.formatted_body]);
  });

  it('previews the content it is given, without reading the hit again', () => {
    const content = getSearchResultEffectiveContent(hit(AGENT, held));
    expect(
      getSearchResultPreviewText(hit(AGENT, held), [], undefined, {
        ...content,
        body: 'Read once.',
      })
    ).toBe('Read once.');
  });

  it("puts no calls in anyone else's message", () => {
    expect(getSearchResultPreviewText(hit('@someone:example.org', held))).toBe(
      'The walrus plan. Done.'
    );
  });
});

describe('getSearchResultBodySnippet', () => {
  it('anchors long snippets around the first highlight', () => {
    const body = `${'a'.repeat(2000)} ISSUE-024 ${'b'.repeat(2000)}`;

    const snippet = getSearchResultBodySnippet(body, ['ISSUE-024'], 200);

    expect(snippet).toContain('ISSUE-024');
    expect(snippet.length).toBeLessThanOrEqual(202);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('anchors around the earliest matching highlight regardless of highlight order', () => {
    const body = `${'a'.repeat(1200)} ISSUE-023 ${'b'.repeat(800)} ISSUE-024 ${'c'.repeat(1200)}`;

    const snippet = getSearchResultBodySnippet(body, ['ISSUE-024', 'ISSUE-023'], 200);

    expect(snippet).toContain('ISSUE-023');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.indexOf('ISSUE-023')).toBeGreaterThanOrEqual(0);
    expect(snippet.endsWith('…')).toBe(true);
  });
  it('anchors on a whole-word match, not on the highlight inside a longer word', () => {
    const body = `alpha_beta ${'gamma '.repeat(300)}be ${'delta '.repeat(300)}`;

    const snippet = getSearchResultBodySnippet(body, ['be'], 200);

    expect(snippet).toMatch(/ be /);
    expect(snippet).not.toContain('alpha_beta');
    expect(snippet.startsWith('…')).toBe(true);
  });
  it('drops the part of a word cut at either edge of the window', () => {
    const body = `gammaal delta delta delta delta xy al ${'omega '.repeat(40)}`;

    expect(getSearchResultBodySnippet(body, ['al'], 102)).toBe(
      `…delta delta delta delta xy al ${'omega '.repeat(11).trim()}…`
    );
    expect(getSearchResultBodySnippet('gamma delta epsilonzeta omega', [], 20)).toBe(
      'gamma delta…'
    );
  });

  it('keeps a window that lies inside one word', () => {
    expect(getSearchResultBodySnippet('x'.repeat(50), [], 12)).toBe(`${'x'.repeat(10)}…`);
  });

  it('keeps the cut word when trimming leaves no letter or digit', () => {
    expect(getSearchResultBodySnippet(`(${'x'.repeat(300)}`, [], 100)).toBe(`(${'x'.repeat(97)}…`);
  });
});

describe('shouldUseLightweightSearchResultBody', () => {
  it('uses the lightweight renderer for long-text search bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'short',
        msgtype: MsgType.Text,
        'io.mindroom.long_text': {
          version: 2,
        },
      })
    ).toBe(true);
  });

  it('uses the lightweight renderer for oversized text bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'x'.repeat(1000),
        msgtype: MsgType.Text,
      })
    ).toBe(true);
  });

  it('keeps the rich renderer for normal short text bodies', () => {
    expect(
      shouldUseLightweightSearchResultBody({
        body: 'normal search body',
        msgtype: MsgType.Text,
      })
    ).toBe(false);
  });
});

describe('getSearchResultLightweightFormattedBody', () => {
  it('keeps bounded formatted bodies for lightweight rendering', () => {
    expect(
      getSearchResultLightweightFormattedBody({
        body: 'x'.repeat(1000),
        formatted_body: '<p>Hello <strong>world</strong></p>',
        msgtype: MsgType.Text,
      })
    ).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('drops oversized formatted bodies on the lightweight path', () => {
    expect(
      getSearchResultLightweightFormattedBody({
        body: 'x'.repeat(1000),
        formatted_body: `<p>${'x'.repeat(6000)}</p>`,
        msgtype: MsgType.Text,
      })
    ).toBeUndefined();
  });
});

describe('getSearchResultLightweightCustomBody', () => {
  it('falls back to lightweight formatted_body when present', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: 'ignored',
          formatted_body: '<p>Hello <strong>world</strong></p>',
          msgtype: MsgType.Text,
        },
        'Hello world'
      )
    ).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('derives markdown html from the preview text when no formatted body exists', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: '## Heading\n\n**bold** `code`',
          msgtype: MsgType.Text,
        },
        '## Heading\n\n**bold** `code`'
      )
    ).toContain('<h2');
  });

  it('returns undefined for plain preview text without markdown', () => {
    expect(
      getSearchResultLightweightCustomBody(
        {
          body: 'plain body',
          msgtype: MsgType.Text,
        },
        'plain body'
      )
    ).toBeUndefined();
  });
});
