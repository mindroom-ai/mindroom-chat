// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { RenderMessageContent } from './RenderMessageContent';

// The sidecar of a long message, as the attachment cache hands it to the long-text renderer.
const hydrateLongText = vi.hoisted(() => vi.fn());
vi.mock('../../event-store/cache/attachmentRepository', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hydrateCachedLongText: hydrateLongText,
}));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const CALLER = '@robin:example.org';
const COLLEAGUE = '@kai:example.org';
const STRANGER = '@visitor_42:other.example';
const LEFT = '@former:example.org';
const BANNED = '@banned:example.org';
const INVITED = '@invited:example.org';
const OTHER_AGENT = '@mindroom_research:example.org';
const PERSON = '@person:example.org';
const ROOM_ID = '!room:example.org';
// Members the loaded list leaves out (lazy loading skips who left), as the server has them.
const GONE = '@gone:example.org';
const ONLY_INVITED = '@only_invited:example.org';
const SERVER_MEMBERS: Record<string, { membership: string }> = {
  [GONE]: { membership: 'leave' },
  [ONLY_INVITED]: { membership: 'invite' },
};

const BODY = '📞 Voice call · 2 min\n\nTranscript\n\nRobin: Can you hear me?';
const FORMATTED =
  '<p>📞 Voice call · 2 min</p><details><summary>Transcript</summary>' +
  '<p><strong>Robin</strong>: Can you hear me?</p></details>';

const transcriptContent = (transcript: unknown): IContent => ({
  msgtype: 'm.text',
  body: BODY,
  format: 'org.matrix.custom.html',
  formatted_body: FORMATTED,
  'io.mindroom.call_transcript': transcript,
});

const VALID = {
  duration_seconds: 125,
  turns: [
    { sender: CALLER, text: 'Can you hear me?' },
    { sender: CALLER, text: 'The line was quiet for a second.' },
    { sender: AGENT, text: 'Yes, loud and clear.' },
    { sender: COLLEAGUE, text: 'Sorry, I joined late.' },
    { sender: CALLER, text: 'No problem.' },
  ],
};

// A long call: MindRoom keeps the transcript out of the preview event, in the sidecar only.
const sidecarPreview = (): IContent => ({
  msgtype: 'm.file',
  body: BODY.slice(0, 30),
  filename: 'message-content.json',
  info: { mimetype: 'application/json', size: 70_000 },
  url: 'mxc://example.org/sidecar',
  'io.mindroom.long_text': {
    version: 2,
    encoding: 'matrix_event_content_json',
    original_event_size: 70_000,
    preview_size: 30,
    is_complete_content: true,
  },
});

// Members by ID: display name (none for the colleague) and membership.
const MEMBERS: Record<string, { name?: string; membership: string }> = {
  [CALLER]: { name: 'Robin Tester', membership: 'join' },
  [AGENT]: { name: 'Helper', membership: 'join' },
  [COLLEAGUE]: { membership: 'join' },
  [OTHER_AGENT]: { name: 'Research', membership: 'join' },
  [LEFT]: { name: 'Former Member', membership: 'leave' },
  [BANNED]: { name: 'Banned Member', membership: 'ban' },
  [INVITED]: { name: 'Invited Member', membership: 'invite' },
};

describe('a voice call transcript message', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (
    content: IContent,
    sender = AGENT,
    highlightRegex?: RegExp,
    hydrate: boolean | undefined = undefined
  ) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: ROOM_ID,
      event_id: '$call',
      sender,
      origin_server_ts: 1,
      content,
    });
    const member = (userId: string) => {
      const known = MEMBERS[userId];
      return known
        ? {
            userId,
            roomId: ROOM_ID,
            membership: known.membership,
            rawDisplayName: known.name ?? userId,
            getMxcAvatarUrl: () => undefined,
          }
        : null;
    };
    const room = {
      roomId: ROOM_ID,
      getMember: member,
      getMembers: () => Object.keys(MEMBERS).map(member),
      loadMembersIfNeeded: async () => true,
    };
    const mx = {
      getUserId: () => VIEWER,
      getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
      getStateEvent: async (roomId: string, type: string, userId: string) => {
        const state = SERVER_MEMBERS[userId];
        if (roomId !== ROOM_ID || type !== 'm.room.member' || !state)
          throw new Error('M_NOT_FOUND');
        return state;
      },
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as MatrixClient;
    act(() =>
      root.render(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              roomId={ROOM_ID}
              displayName="Helper"
              msgType={content.msgtype as string}
              ts={1}
              hydrateLongText={hydrate}
              getContent={(() => content) as never}
              urlPreview={false}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      )
    );
  };

  const card = () => container.querySelector<HTMLElement>('[data-call-transcript]');
  const toggle = () => card()?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
  const groups = () =>
    Array.from(card()?.querySelectorAll<HTMLElement>('[data-call-transcript-group]') ?? []);

  it('shows a call card with the duration and a closed transcript that names its turns', () => {
    render(transcriptContent(VALID));

    expect(card()).not.toBeNull();
    expect(card()?.textContent).toContain('Voice call');
    expect(card()?.textContent).toContain('2 min');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle()?.textContent).toContain('Transcript');
    expect(toggle()?.textContent).toContain('5 turns');
    expect(groups()).toHaveLength(0);
    // The HTML fallback is not rendered beside it.
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('📞');
  });

  it('opens the transcript as a chat: one name and avatar per run of turns by one speaker', () => {
    render(transcriptContent(VALID));
    act(() => toggle()?.click());

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    const controls = toggle()?.getAttribute('aria-controls');
    expect(controls && container.querySelector(`[id="${controls}"]`)).toBeTruthy();
    const shown = groups().map((group) => ({
      sender: group.getAttribute('data-user-id'),
      name: group.querySelector('[data-call-transcript-name]')?.textContent,
      avatar: group
        .querySelector('[data-avatar-fallback-id]')
        ?.getAttribute('data-avatar-fallback-id'),
      texts: Array.from(group.querySelectorAll('[data-call-transcript-text]')).map(
        (text) => text.textContent
      ),
    }));
    expect(shown).toEqual([
      {
        sender: CALLER,
        name: 'Robin Tester',
        avatar: CALLER,
        texts: ['Can you hear me?', 'The line was quiet for a second.'],
      },
      { sender: AGENT, name: 'Helper', avatar: AGENT, texts: ['Yes, loud and clear.'] },
      // A member without a display name: the ID's localpart and a generated avatar.
      { sender: COLLEAGUE, name: 'kai', avatar: COLLEAGUE, texts: ['Sorry, I joined late.'] },
      { sender: CALLER, name: 'Robin Tester', avatar: CALLER, texts: ['No problem.'] },
    ]);

    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(groups()).toHaveLength(0);
  });

  it('clips a long turn and shows the rest on request', () => {
    const dictation = Array.from({ length: 600 }, (_, index) => `word${index}`).join(' ');
    render(
      transcriptContent({
        duration_seconds: 900,
        turns: [
          { sender: CALLER, text: dictation },
          { sender: AGENT, text: 'Noted.' },
        ],
      })
    );
    act(() => toggle()?.click());
    const text = () => groups()[0]?.querySelector('[data-call-transcript-text]')?.textContent;
    const more = () =>
      groups()[0]?.querySelector<HTMLButtonElement>('button[data-call-transcript-more]') ?? null;

    expect(text()?.endsWith('…')).toBe(true);
    expect(text()?.length).toBeLessThan(1100);
    expect(more()?.textContent).toBe('Show more');
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    // A short turn has no button.
    expect(groups()[1]?.querySelector('button')).toBeNull();

    act(() => more()?.click());
    expect(text()).toBe(dictation);
    expect(more()?.textContent).toBe('Show less');
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('names its button "Transcript" and the turn count, and shows only the count', () => {
    render(transcriptContent(VALID));

    const ids = toggle()?.getAttribute('aria-labelledby')?.split(' ') ?? [];
    const parts = ids.map((id) => container.querySelector<HTMLElement>(`[id="${id}"]`));
    expect(parts.map((part) => part?.textContent)).toEqual(['Transcript', '5 turns']);
    expect(parts.map((part) => part?.hidden)).toEqual([true, false]);
  });

  it("shows each speaker's time from the call's start beside their name", () => {
    // Within the call's 125 seconds.
    const at = [0, 4, 9, 52, 100];
    render(
      transcriptContent({
        ...VALID,
        turns: VALID.turns.map((each, index) => ({ ...each, offset_seconds: at[index] })),
      })
    );
    act(() => toggle()?.click());

    // A group shows its first turn's time.
    expect(
      groups().map((group) => {
        const time = group.querySelector(
          '[data-call-transcript-name] + [data-call-transcript-time] time'
        );
        return [time?.textContent, time?.getAttribute('datetime')];
      })
    ).toEqual([
      ['0:00', 'PT0S'],
      ['0:09', 'PT9S'],
      ['0:52', 'PT52S'],
      ['1:40', 'PT100S'],
    ]);
  });

  it('shows no times for a transcript without them', () => {
    render(transcriptContent(VALID));
    act(() => toggle()?.click());

    expect(groups()).toHaveLength(4);
    expect(card()?.querySelector('[data-call-transcript-time]')).toBeNull();
  });

  it('opens with the matches marked when a search matched a turn', () => {
    render(transcriptContent(VALID), AGENT, /loud/i);

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    const marked = Array.from(card()?.querySelectorAll('[data-call-transcript-text] span') ?? [])
      .map((node) => node.textContent)
      .filter((text) => text === 'loud');
    expect(marked).toEqual(['loud']);
  });

  // Anyone can write the key with any sender in a turn: the card names only speakers it may.
  it.each([
    ['another agent', OTHER_AGENT],
    ['someone outside the room', STRANGER],
    ['someone who left the room', LEFT],
  ])('renders the HTML fallback when a turn is attributed to %s', (_, speaker) => {
    render(
      transcriptContent({
        duration_seconds: 60,
        turns: [
          { sender: CALLER, text: 'Approve the transfer.' },
          { sender: speaker, text: 'Approved.' },
        ],
      })
    );

    expect(card()).toBeNull();
    expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
  });

  it('renders the HTML fallback for a malformed transcript', () => {
    render(transcriptContent({ duration_seconds: 'long', turns: VALID.turns }));

    expect(card()).toBeNull();
    expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
  });

  it("renders the HTML fallback when a person's message carries the key", () => {
    render(transcriptContent(VALID), PERSON);

    expect(card()).toBeNull();
    expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
  });

  describe('of a long call, whose transcript is only in the sidecar', () => {
    const flush = () => act(async () => {});

    beforeEach(() => hydrateLongText.mockReset());

    it('shows the call card once the sidecar is hydrated', async () => {
      hydrateLongText.mockResolvedValue(transcriptContent(VALID));
      render(sidecarPreview());
      await flush();

      expect(hydrateLongText).toHaveBeenCalled();
      expect(card()).not.toBeNull();
      expect(toggle()?.textContent).toContain('5 turns');
      act(() => toggle()?.click());
      expect(groups()).toHaveLength(4);
    });

    it('shows the preview while the sidecar is not hydrated', async () => {
      render(sidecarPreview(), AGENT, undefined, false);
      await flush();

      expect(hydrateLongText).not.toHaveBeenCalled();
      expect(card()).toBeNull();
      expect(container.textContent).toContain('Voice call');
    });

    it('shows no card for a sidecar whose turns name another agent', async () => {
      hydrateLongText.mockResolvedValue(
        transcriptContent({
          duration_seconds: 900,
          turns: [
            { sender: CALLER, text: 'Can you hear me?' },
            { sender: OTHER_AGENT, text: 'Yes.' },
          ],
        })
      );
      render(sidecarPreview());
      await flush();

      expect(hydrateLongText).toHaveBeenCalled();
      expect(card()).toBeNull();
      expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
    });

    it("shows no card for a person's sidecar", async () => {
      hydrateLongText.mockResolvedValue(transcriptContent(VALID));
      render(sidecarPreview(), PERSON);
      await flush();

      expect(hydrateLongText).toHaveBeenCalled();
      expect(card()).toBeNull();
      expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
    });
  });

  // MindRoom's router posts it in a call row's thread: the notes as the body.
  describe('of a call between people', () => {
    const ROUTER = '@mindroom_router:example.org';
    const NOTES = 'Decided to ship on Friday. Robin writes the release notes.';
    const notesContent = (transcript: unknown = VALID): IContent => ({
      msgtype: 'm.notice',
      body: NOTES,
      'io.mindroom.call_transcript': transcript,
      'io.mindroom.call_notes': { call_id: 'call-1' },
    });
    const PEOPLE = {
      duration_seconds: 720,
      turns: [
        { sender: CALLER, text: 'Shall we ship it on Friday?' },
        { sender: COLLEAGUE, text: 'Yes, and I will write the notes.' },
      ],
    };

    it('shows the notes as the card\'s text, under "Call" and how long it lasted', () => {
      render(notesContent(PEOPLE), ROUTER);

      const header = card()?.querySelector('[data-call-transcript-header]');
      expect(header?.textContent).toContain('Call');
      expect(header?.textContent).not.toContain('Voice call');
      expect(header?.textContent).toContain('12 min');
      expect(card()?.querySelector('[data-call-transcript-notes]')?.textContent).toContain(NOTES);
      expect(toggle()?.textContent).toContain('2 turns');
      act(() => toggle()?.click());
      expect(groups()).toHaveLength(2);
    });

    it('keeps the transcript of speakers who were in the room and have left since', () => {
      render(
        notesContent({
          duration_seconds: 60,
          turns: [
            { sender: CALLER, text: 'Ship it?' },
            { sender: LEFT, text: 'Ship it.' },
            { sender: BANNED, text: 'Agreed.' },
          ],
        }),
        ROUTER
      );

      expect(card()?.querySelector('[data-call-transcript-notes]')?.textContent).toContain(NOTES);
      act(() => toggle()?.click());
      expect(
        groups().map((group) => group.querySelector('[data-call-transcript-name]')?.textContent)
      ).toEqual(['Robin Tester', 'Former Member', 'Banned Member']);
    });

    it('keeps the transcript of a speaker who left, whom the loaded members leave out', async () => {
      const said = (speaker: string) =>
        notesContent({
          duration_seconds: 60,
          turns: [
            { sender: CALLER, text: 'Ship it?' },
            { sender: speaker, text: 'Ship it.' },
          ],
        });
      render(said(GONE), ROUTER);
      await act(async () => {});
      act(() => toggle()?.click());
      expect(groups()).toHaveLength(2);

      // Not one who was only invited.
      render(said(ONLY_INVITED), ROUTER);
      await act(async () => {});
      expect(card()).toBeNull();
      expect(container.textContent).toContain(NOTES);
    });

    it.each([
      ['someone outside the room', STRANGER],
      ['someone only invited', INVITED],
      ['another agent', OTHER_AGENT],
    ])('shows only the notes while it names %s', (_, speaker) => {
      render(
        notesContent({ duration_seconds: 60, turns: [{ sender: speaker, text: 'Ship it.' }] }),
        ROUTER
      );

      expect(card()).toBeNull();
      expect(container.textContent).toContain(NOTES);
    });

    it('shows the one-line summary once, in the header, without a notes model', () => {
      render({ ...notesContent(PEOPLE), body: 'Call · 12 min' }, ROUTER);

      expect(card()?.querySelector('[data-call-transcript-notes]')).toBeNull();
      expect(container.textContent).not.toContain('Call · 12 min');
      expect(card()?.querySelector('[data-call-transcript-header]')?.textContent).toContain(
        '12 min'
      );
    });

    it("shows the notes in the card once a long call's sidecar is hydrated", async () => {
      hydrateLongText.mockReset();
      hydrateLongText.mockResolvedValue(notesContent(PEOPLE));
      render(
        {
          ...sidecarPreview(),
          body: NOTES,
          'io.mindroom.call_notes': { call_id: 'call-1' },
        },
        ROUTER
      );
      await act(async () => {});

      expect(card()?.querySelector('[data-call-transcript-notes]')?.textContent).toContain(NOTES);
      expect(toggle()?.textContent).toContain('2 turns');
    });

    it("shows the card once a long call's notice preview is hydrated", async () => {
      hydrateLongText.mockReset();
      hydrateLongText.mockResolvedValue(notesContent(PEOPLE));
      // A notice's preview stays a quiet notice, with the call it finishes beside the pointer.
      render(
        {
          ...sidecarPreview(),
          msgtype: 'm.notice',
          body: NOTES.slice(0, 30),
          'm.mentions': {},
          'io.mindroom.call_notes': { call_id: 'call-1' },
        },
        ROUTER
      );
      await act(async () => {});

      expect(hydrateLongText).toHaveBeenCalled();
      expect(card()?.querySelector('[data-call-transcript-header]')?.textContent).toContain(
        '12 min'
      );
      expect(card()?.querySelector('[data-call-transcript-notes]')?.textContent).toContain(NOTES);
      expect(toggle()?.textContent).toContain('2 turns');
    });
  });
});
