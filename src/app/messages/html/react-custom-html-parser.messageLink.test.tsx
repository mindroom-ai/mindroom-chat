import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LINKIFY_OPTS,
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  makeMentionCustomProps,
  renderMatrixMention,
  renderTextWithLatex,
} from './react-custom-html-parser';

vi.mock('../../rich-text/CustomHtml.css', () => ({
  Mention: () => 'Mention',
  MessageLinkPill: 'MessageLinkPill',
  Spoiler: () => 'Spoiler',
  Emoticon: () => 'Emoticon',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));

const ROOM_ID = '!harbor:example.org';
const ROOT_ID = '$root';
const REPLY_ID = '$reply';
const PLAIN_ID = '$plain';
const LINK = (room: string, event: string) => `https://matrix.to/#/${room}/${event}`;

/** A client in one room, "Harbor operations", whose thread `$root` holds `$reply`. */
const client = {
  getRoom: (roomId: string) =>
    roomId === ROOM_ID
      ? {
          roomId,
          name: 'Harbor operations',
          getThread: (eventId: string) => (eventId === ROOT_ID ? {} : null),
          findEventById: (eventId: string) =>
            eventId === REPLY_ID ? { threadRootId: ROOT_ID } : undefined,
          getCanonicalAlias: () => '#harbor:example.org',
          getAltAliases: () => [],
        }
      : null,
  getRooms: () => [client.getRoom(ROOM_ID)],
  getUserId: () => '@reader:example.org',
} as unknown as MatrixClient;

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const render = (node: React.ReactNode) => {
  act(() => {
    renderer = create(<>{node}</>);
  });
  return renderer!;
};

const linkOf = (root: ReactTestRenderer) =>
  root.root.find((node) => node.type === 'a' && node.props['data-mention-event-id'] !== undefined);

const textOf = (root: ReactTestRenderer) => {
  const json = root.toJSON();
  const collect = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(collect).join('');
    if (value && typeof value === 'object' && 'children' in value) {
      return collect(value.children);
    }
    return '';
  };
  return collect(json);
};

const mention = (href: string, content?: React.ReactNode) =>
  renderMatrixMention(client, ROOM_ID, href, makeMentionCustomProps(), content);

describe('links to messages', () => {
  it('name the room and keep the URL as their title instead of showing it', () => {
    const href = LINK(ROOM_ID, PLAIN_ID);
    const root = render(mention(href));
    expect(textOf(root)).toBe('Message in #Harbor operations');
    expect(linkOf(root).props.title).toBe(href);
    expect(linkOf(root).props.className).toBe('Mention MessageLinkPill');
    expect(linkOf(root).props['data-mention-id']).toBe(ROOM_ID);
    expect(linkOf(root).props['data-mention-event-id']).toBe(PLAIN_ID);
  });

  it('renders canonical Universal Links as MessageLinkPill even on another origin', () => {
    const href = `https://chat.mindroom.chat/${ROOM_ID}/${PLAIN_ID}?via=example.org`;
    const root = render(mention(href));
    expect(textOf(root)).toBe('Message in #Harbor operations');
    expect(linkOf(root).props.title).toBe(href);
    expect(linkOf(root).props.className).toBe('Mention MessageLinkPill');
    expect(linkOf(root).props['data-mention-id']).toBe(ROOM_ID);
    expect(linkOf(root).props['data-mention-event-id']).toBe(PLAIN_ID);
    expect(linkOf(root).props['data-mention-via']).toBe('example.org');
  });

  it('leaves Universal Links with extra routing query params as normal links', () => {
    const href = `https://chat.mindroom.chat/${ROOM_ID}?threadId=${ROOT_ID}`;
    const linkifyOpts = {
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((url) => mention(url)),
    };
    const opts = getReactCustomHtmlParser(client, ROOM_ID, { linkifyOpts });
    const root = render(parse(`see <a href="${href}">${href}</a>`, opts));
    const anchor = root.root.find((node) => node.type === 'a');
    expect(anchor.props.href).toBe(href);
    expect(anchor.props['data-mention-id']).toBeUndefined();
    expect(anchor.props['data-mention-event-id']).toBeUndefined();
    expect(textOf(root)).toBe(`see ${href}`);
  });

  it('keep an authored label and its spoiler on a link to a room, which still opens in the app', () => {
    const href = `https://chat.mindroom.chat/${ROOM_ID}?via=example.org`;
    const opts = getReactCustomHtmlParser(client, ROOM_ID, { linkifyOpts: LINKIFY_OPTS });
    const spoilers = (root: ReactTestRenderer) =>
      root.root.findAll(
        (node) => node.type === 'span' && node.props['data-mx-spoiler'] !== undefined
      );

    // A link typed as Markdown, and an anchor of another client around a spoiler.
    ['<a data-md href', '<a href'].forEach((anchorStart) => {
      const root = render(
        parse(`see ${anchorStart}="${href}"><span data-mx-spoiler>the berth plan</span></a>`, opts)
      );
      const anchor = root.root.find((node) => node.type === 'a');
      expect(anchor.props['data-mention-id']).toBe(ROOM_ID);
      expect(anchor.props['data-mention-via']).toBe('example.org');
      expect(anchor.props.className).toBeUndefined();
      expect(spoilers(root)).toHaveLength(1);
      expect(textOf(root)).toBe('see the berth plan');
    });
    const labelled = render(parse(`see <a data-md href="${href}">the berth plan</a>`, opts));
    expect(textOf(labelled)).toBe('see the berth plan');
    expect(labelled.root.find((node) => node.type === 'a').props['data-mention-id']).toBe(ROOM_ID);

    // A mention of the room and its bare URL are still pills that name the room.
    ['#Harbor', href].forEach((text) => {
      const root = render(parse(`see <a href="${href}">${text}</a>`, opts));
      expect(textOf(root)).toBe('see #Harbor operations');
      expect(root.root.find((node) => node.type === 'a').props.className).toBe('Mention');
    });
  });

  it('say thread for a thread root or a reply the client knows', () => {
    expect(textOf(render(mention(LINK(ROOM_ID, ROOT_ID))))).toBe('Thread in #Harbor operations');
    expect(textOf(render(mention(LINK(ROOM_ID, REPLY_ID))))).toBe('Thread in #Harbor operations');
  });

  it('name a known room by its name also when the link uses its alias', () => {
    expect(textOf(render(mention(LINK('#harbor:example.org', PLAIN_ID))))).toBe(
      'Message in #Harbor operations'
    );
  });

  it('name an unknown room by its alias, and an unknown room ID not at all', () => {
    expect(textOf(render(mention(LINK('#quay:example.org', '$event'))))).toBe(
      'Message in #quay:example.org'
    );
    expect(textOf(render(mention(LINK('!elsewhere:example.org', '$event'))))).toBe(
      'Message in another room'
    );
  });

  it('keep a link text of their own', () => {
    const root = render(mention(LINK(ROOM_ID, PLAIN_ID), 'the berth plan'));
    expect(textOf(root)).toBe('the berth plan');
    expect(linkOf(root).props.className).toBeUndefined();
  });

  it('read the same in plain text, and in HTML whose link text is the URL', () => {
    const href = LINK(ROOM_ID, ROOT_ID);
    const linkifyOpts = {
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((url) => mention(url)),
    };
    expect(textOf(render(renderTextWithLatex(`see ${href}`, { linkifyOpts })))).toBe(
      'see Thread in #Harbor operations'
    );

    const opts = getReactCustomHtmlParser(client, ROOM_ID, { linkifyOpts });
    expect(textOf(render(parse(`see <a href="${href}">${href}</a>`, opts)))).toBe(
      'see Thread in #Harbor operations'
    );
    expect(textOf(render(parse(`see <a href="${href}">the plan</a>`, opts)))).toBe('see the plan');
  });
});
