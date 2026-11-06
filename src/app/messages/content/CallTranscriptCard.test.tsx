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
const STRANGER = '@visitor_42:other.example';
const PERSON = '@person:example.org';
const ROOM_ID = '!room:example.org';

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
    { sender: STRANGER, text: 'Sorry, I joined late.' },
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

const MEMBERS: Record<string, string> = {
  [CALLER]: 'Robin Tester',
  [AGENT]: 'Helper',
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
    const room = {
      roomId: ROOM_ID,
      getMember: (userId: string) =>
        MEMBERS[userId]
          ? { userId, rawDisplayName: MEMBERS[userId], getMxcAvatarUrl: () => undefined }
          : null,
    };
    const mx = {
      getUserId: () => VIEWER,
      getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
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
      // Someone the room does not know: the ID's localpart and a generated avatar.
      { sender: STRANGER, name: 'visitor_42', avatar: STRANGER, texts: ['Sorry, I joined late.'] },
      { sender: CALLER, name: 'Robin Tester', avatar: CALLER, texts: ['No problem.'] },
    ]);

    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(groups()).toHaveLength(0);
  });

  it('opens with the matches marked when a search matched a turn', () => {
    render(transcriptContent(VALID), AGENT, /loud/i);

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    const marked = Array.from(card()?.querySelectorAll('[data-call-transcript-text] span') ?? [])
      .map((node) => node.textContent)
      .filter((text) => text === 'loud');
    expect(marked).toEqual(['loud']);
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

    it("shows no card for a person's sidecar", async () => {
      hydrateLongText.mockResolvedValue(transcriptContent(VALID));
      render(sidecarPreview(), PERSON);
      await flush();

      expect(hydrateLongText).toHaveBeenCalled();
      expect(card()).toBeNull();
      expect(container.querySelector('details summary')?.textContent).toBe('Transcript');
    });
  });
});
