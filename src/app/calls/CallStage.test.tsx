// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, within } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import { CallStage } from './CallStage';
import * as css from './CallStage.css';

/** A long name two people in the call share; the room puts each one's user ID after it. */
const TWIN = 'Alexandra Montgomery-Wellington';
const withId = (name: string, userId: string) => `${name} (\u2066${userId}\u2069)`;

const NAMES: Record<string, string> = {
  '@me:stage.test': 'Me',
  '@sam:stage.test': withId(TWIN, '@sam:stage.test'),
  '@samuel:stage.test': withId(TWIN, '@samuel:stage.test'),
  '@mind:stage.test': 'Mind',
  '@ada:stage.test': 'Ada',
  '@tom:stage.test': 'Tom',
  '@mindroom_helper:stage.test': 'Helper',
};

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  // No room to load the members of: the tiles name everyone as the room's loaded list does.
  useMatrixClient: () => ({ mxcUrlToHttp: () => null, getRoom: () => undefined }),
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/room')>()),
  getSenderName: (_room: Room, userId: string) => NAMES[userId] ?? userId,
  getMemberAvatarMxc: () => undefined,
}));
vi.mock('../avatars/UserAvatar', () => ({
  UserAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

// jsdom lays nothing out: the stage hears its size from this observer, at once.
const ROOMY_STAGE = { width: 384, height: 300 };
const stageSize = { ...ROOMY_STAGE };
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    const contentRect = { width: stageSize.width, height: stageSize.height } as DOMRectReadOnly;
    this.callback(
      [{ target, contentRect } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }

  unobserve() {}

  disconnect() {}
}

const room = { roomId: '!stage:stage.test' } as Room;
const track = () => ({ attach: vi.fn(), detach: vi.fn() } as unknown as CallVideoTrack);

const person = (name: string, rest: Partial<CallParticipant> = {}): CallParticipant => ({
  key: `@${name}:stage.test:DEVICE`,
  userId: `@${name}:stage.test`,
  deviceId: 'DEVICE',
  local: false,
  connected: true,
  speaking: false,
  microphone: true,
  ...rest,
});

const me = person('me', { local: true });
const mind = person('mind');
const ada = person('ada');
const tom = person('tom');
/** `who` in the call on a second device, a phone. */
const onPhone = (who: CallParticipant, rest: Partial<CallParticipant> = {}): CallParticipant => ({
  ...who,
  key: `${who.userId}:PHONE`,
  deviceId: 'PHONE',
  local: false,
  ...rest,
});
// A MindRoom agent, by its user name.
const helper = person('mindroom_helper');
// Two people with the same name.
const sam = person('sam');
const samuel = person('samuel');

type StageProps = React.ComponentProps<typeof CallStage>;

const showStage = (props: Partial<StageProps> & Pick<StageProps, 'participants'>) =>
  render(<CallStage room={room} speakerView={false} microphone {...props} />);

const stageOf = (container: HTMLElement) => {
  const stage = container.querySelector<HTMLElement>('[data-call-stage]');
  if (!stage) throw new Error('no stage');
  return stage;
};

/** Elements with every class of a style (a composed one holds several). */
const withStyle = (root: HTMLElement, className: string) =>
  root.querySelectorAll(`.${className.trim().split(/\s+/).join('.')}`);

const tileOf = (container: HTMLElement, userId: string) => {
  const tile = container.querySelector<HTMLElement>(`[data-call-tile="${userId}"]`);
  if (!tile) throw new Error(`no tile of ${userId}`);
  return tile;
};

/**
 * The element that shows `text` whole: the smallest one that holds all of it, as a name and the
 * user ID after it sit in elements of their own.
 */
const showing = (root: HTMLElement, text: string) =>
  within(root).queryAllByText(
    (_, element) =>
      element?.textContent === text &&
      !Array.from(element.children).some((child) => child.textContent === text)
  );

/**
 * `root` shows the name of `userId` with the user ID the room put after it in an element of its
 * own, which wraps rather than being cut short with the name.
 */
const keepsUserId = (root: HTMLElement, userId: string, before = '', after = '') => {
  const suffix = ` (\u2066${userId}\u2069)${after}`;
  const [id] = showing(root, suffix);
  expect(id).toBeTruthy();
  expect(id?.style.overflowWrap).toBe('anywhere');
  expect(showing(root, `${before}${TWIN}`)).toHaveLength(1);
};

/** Whose shared screens the stage shows, in its order. */
const screensShown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-call-screen]'), ({ dataset }) => {
    return dataset.callScreen;
  });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  Object.assign(stageSize, ROOMY_STAGE);
  cleanup();
  vi.unstubAllGlobals();
});

describe('CallStage without video', () => {
  it('shows the one other person as a 64 px face without a name', () => {
    const { container } = showStage({ participants: [me, mind] });

    expect(stageOf(container).dataset.callStage).toBe('voice');
    const face = tileOf(container, mind.userId);
    expect(withStyle(face, css.VoiceAvatar.solo)).toHaveLength(1);
    expect(withStyle(container, css.VoiceAvatar.group)).toHaveLength(0);
    expect(within(stageOf(container)).queryByText('Mind')).toBeNull();
  });

  it('names two or more others under 48 px faces', () => {
    const { container } = showStage({ participants: [me, mind, ada] });

    expect(withStyle(container, css.VoiceAvatar.group)).toHaveLength(2);
    expect(within(tileOf(container, mind.userId)).getByText('Mind')).toBeTruthy();
    expect(within(tileOf(container, ada.userId)).getByText('Ada')).toBeTruthy();
  });

  it('keeps this device in the people list for screen readers only, with its state', () => {
    const { container } = showStage({ participants: [me, mind] });

    const own = tileOf(container, me.userId);
    expect(own.className).toContain(css.OffStage);
    expect(own.dataset.connected).toBe('true');
    expect(own.textContent).toBe('Me (you)');
  });

  it('marks a remote microphone that is off', () => {
    const { container } = showStage({ participants: [me, { ...mind, microphone: false }] });

    expect(
      within(tileOf(container, mind.userId)).getByRole('img', { name: 'Microphone off' })
    ).toBeTruthy();
  });

  it('says who speaks, else that the microphone is off, else that an agent listens', () => {
    const speaking = showStage({
      participants: [me, { ...ada, speaking: false }, { ...mind, speaking: true }],
      microphone: false,
    });
    expect(within(speaking.container).getByText('Mind is speaking')).toBeTruthy();
    expect(
      speaking.container.querySelector('[data-call-voice-bars]')?.getAttribute('data-speaking')
    ).toBe('true');
    cleanup();

    const muted = showStage({ participants: [me, mind], microphone: false });
    expect(within(muted.container).getByText('You are muted')).toBeTruthy();
    cleanup();

    const listening = showStage({ participants: [{ ...me, speaking: true }, helper] });
    expect(within(listening.container).getByText('Listening')).toBeTruthy();
    expect(
      listening.container.querySelector('[data-call-voice-bars]')?.getAttribute('data-speaking')
    ).toBe('true');
  });

  it('says nothing while the people in the call are quiet', () => {
    const { container } = showStage({ participants: [{ ...me, speaking: true }, mind, helper] });
    expect(within(container).queryByText('Listening')).toBeNull();
    expect(container.querySelector('[data-call-voice-bars]')).not.toBeNull();
    expect(container.querySelector(`.${css.VoiceStatus}`)).toBeNull();
  });

  it('waits for others in place of the bars and the status while alone in the call', () => {
    for (const microphone of [true, false]) {
      const { container } = showStage({ participants: [me], microphone });
      expect(within(container).getByText('Waiting for others to join')).toBeTruthy();
      expect(container.querySelector('[data-call-voice-bars]')).toBeNull();
      expect(within(container).queryByText('Listening')).toBeNull();
      expect(within(container).queryByText('You are muted')).toBeNull();
      // This device stays in the people list for screen readers.
      expect(tileOf(container, me.userId).textContent).toBe('Me (you)');
      cleanup();
    }
  });

  it('shows the awaited agent waiting until it joins', () => {
    const awaited = person('mind', { key: 'awaited:@mind:stage.test', deviceId: '' });
    const { container } = showStage({
      participants: [me],
      awaited: { ...awaited, connected: false },
    });

    expect(stageOf(container).dataset.callStage).toBe('voice');
    const face = tileOf(container, mind.userId);
    expect(face.dataset.connected).toBe('false');
    expect(face.textContent).toContain('Waiting for Mind');
  });

  it('shows someone on two devices once, speaking while either speaks', () => {
    const { container } = showStage({
      participants: [me, ada, onPhone(ada, { speaking: true, microphone: false })],
    });

    expect(container.querySelectorAll(`[data-call-tile="${ada.userId}"]`)).toHaveLength(1);
    // One other person: one 64 px face without a name, heard on the device with its microphone on.
    expect(withStyle(container, css.VoiceAvatar.solo)).toHaveLength(1);
    expect(withStyle(container, css.VoiceAvatar.group)).toHaveLength(0);
    expect(within(stageOf(container)).queryByText('Ada')).toBeNull();
    const face = tileOf(container, ada.userId);
    expect(face.dataset.speaking).toBe('true');
    expect(within(face).queryByRole('img', { name: 'Microphone off' })).toBeNull();
    expect(within(container).getByText('Ada is speaking')).toBeTruthy();
  });

  it("names the others once each, and counts this person's other device as them", () => {
    const { container } = showStage({
      participants: [me, mind, onPhone(mind), ada, onPhone(me)],
    });

    expect(withStyle(container, css.VoiceAvatar.group)).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-call-tile]'), (tile) => {
        return tile.dataset.callTile;
      })
    ).toEqual([me.userId, mind.userId, ada.userId]);
    expect(tileOf(container, me.userId).className).toContain(css.OffStage);
    cleanup();

    const alone = showStage({ participants: [me, onPhone(me)] });
    expect(within(alone.container).getByText('Waiting for others to join')).toBeTruthy();
  });

  it('keeps the user IDs of two people with the same long name, apart from the name it may cut', () => {
    const { container } = showStage({
      participants: [me, sam, { ...samuel, speaking: true }],
    });

    for (const twin of [sam, samuel]) {
      const face = tileOf(container, twin.userId);
      expect(face.getAttribute('aria-label')).toBe(NAMES[twin.userId]);
      keepsUserId(face, twin.userId);
    }
    const status = withStyle(container, css.VoiceStatus)[0] as HTMLElement;
    keepsUserId(status, samuel.userId, '', ' is speaking');
    cleanup();

    const awaited = { ...samuel, key: `awaited:${samuel.userId}`, deviceId: '', connected: false };
    const waiting = showStage({ participants: [me, sam], awaited });
    keepsUserId(tileOf(waiting.container, samuel.userId), samuel.userId, 'Waiting for ', '…');
  });

  it('says an agent listens only once the agent the call waits for is connected', () => {
    const awaited = { ...helper, key: `awaited:${helper.userId}`, deviceId: '', connected: false };
    const waiting = showStage({ participants: [me], awaited });
    expect(tileOf(waiting.container, helper.userId).textContent).toContain('Waiting for Helper');
    expect(within(waiting.container).queryByText('Listening')).toBeNull();
    cleanup();

    const joined = showStage({ participants: [me, helper] });
    expect(within(joined.container).getByText('Listening')).toBeTruthy();
  });
});

describe('CallStage with video', () => {
  it('lays a tile per person in a grid while a camera is on', () => {
    const { container } = showStage({ participants: [me, { ...mind, video: track() }, ada] });

    const stage = stageOf(container);
    expect(stage.dataset.callStage).toBe('video');
    expect(stage.hasAttribute('data-speaker-view')).toBe(false);
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(3);
    expect(tileOf(container, mind.userId).querySelector('video')).not.toBeNull();
  });

  it('puts a shared screen in focus, the others in a row and the own camera in the inset', () => {
    const { container } = showStage({
      participants: [{ ...me, video: track() }, { ...mind, screen: track() }, ada],
    });

    const stage = stageOf(container);
    expect(stage.dataset.callStage).toBe('video');
    expect(stage.hasAttribute('data-speaker-view')).toBe(true);
    expect(container.querySelector(`[data-call-screen="${mind.userId}"]`)).not.toBeNull();
    const inset = container.querySelector<HTMLElement>('[data-call-inset]');
    expect(inset?.querySelector(`[data-call-tile="${me.userId}"] video`)).not.toBeNull();
    // Everyone still has their one tile: the sharer and Ada among the faces.
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(3);
  });

  it('shows every screen while two or more are shared, the own one last, then everyone', () => {
    const { container } = showStage({
      participants: [
        { ...me, video: track(), screen: track() },
        { ...mind, screen: track() },
        ada,
        { ...tom, screen: track() },
      ],
    });

    const stage = stageOf(container);
    expect(stage.dataset.callStage).toBe('video');
    expect(stage.hasAttribute('data-speaker-view')).toBe(false);
    expect(screensShown(container)).toEqual([mind.userId, tom.userId, me.userId]);
    expect(container.querySelector('[data-call-inset]')).toBeNull();
    // Everyone keeps their one tile, after the screens.
    const tiles = container.querySelectorAll<HTMLElement>('[data-call-tile]');
    expect(Array.from(tiles, (tile) => tile.dataset.callTile)).toEqual(
      [me, mind, ada, tom].map(({ userId }) => userId)
    );
    const list = withStyle(container, css.Screens)[0];
    expect(list?.lastElementChild?.getAttribute('data-call-tile')).toBe(tom.userId);
    expect(list?.firstElementChild?.getAttribute('data-call-screen')).toBe(mind.userId);
  });

  it('shows every screen over a picked speaker view and a stage too small for the grid', () => {
    stageSize.width = 300;
    stageSize.height = 120;
    const onForcedChange = vi.fn();
    const { container } = showStage({
      participants: [me, { ...mind, screen: track() }, { ...ada, screen: track() }, tom],
      speakerView: true,
      onForcedChange,
    });

    expect(stageOf(container).hasAttribute('data-speaker-view')).toBe(false);
    expect(screensShown(container)).toEqual([mind.userId, ada.userId]);
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(4);
    expect(onForcedChange).toHaveBeenLastCalledWith(true);
  });

  it('goes back to speaker view with the one screen left once a second share stops', () => {
    const sharing = { ...mind, screen: track() };
    const stage = (participants: CallParticipant[]) => (
      <CallStage room={room} speakerView={false} microphone participants={participants} />
    );
    const { container, rerender } = render(stage([{ ...me, screen: track() }, sharing, ada]));
    expect(screensShown(container)).toEqual([mind.userId, me.userId]);

    rerender(stage([me, sharing, ada]));
    expect(stageOf(container).hasAttribute('data-speaker-view')).toBe(true);
    expect(screensShown(container)).toEqual([mind.userId]);
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(3);
  });

  it('shows speaker view when the person picks it, with the remote speaker in focus', () => {
    const { container } = showStage({
      participants: [{ ...me, video: track() }, mind, { ...ada, speaking: true, video: track() }],
      speakerView: true,
    });

    expect(stageOf(container).hasAttribute('data-speaker-view')).toBe(true);
    expect(tileOf(container, ada.userId).querySelector('video')).not.toBeNull();
    expect(tileOf(container, mind.userId).querySelector('video')).toBeNull();
    expect(container.querySelector('[data-call-inset]')).not.toBeNull();
  });

  it('leaves the inset out while the own camera is the one in focus', () => {
    const { container } = showStage({
      participants: [{ ...me, video: track() }],
      speakerView: true,
    });

    expect(stageOf(container).hasAttribute('data-speaker-view')).toBe(true);
    expect(container.querySelector('[data-call-inset]')).toBeNull();
    expect(tileOf(container, me.userId).querySelector('video')).not.toBeNull();
  });

  it('shows five faces at most in speaker view, the last one counting the rest', () => {
    const crowd = Array.from({ length: 8 }, (_, index) =>
      person(`guest${index}`, { key: `@guest${index}:stage.test:DEVICE` })
    );
    const { container } = showStage({
      participants: [{ ...mind, screen: track() }, ...crowd],
    });

    const faces = container.querySelectorAll(`.${css.SpeakerFace.trim().split(/\s+/).join('.')}`);
    expect(faces).toHaveLength(5);
    // The sharer and the first three guests, then one face for the other five.
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(4);
    const more = faces[4] as HTMLElement;
    expect(more.hasAttribute('data-call-tile')).toBe(false);
    expect(more.getAttribute('aria-label')).toBe('5 more');
    expect(more.textContent).toBe('+5');
    // A filled circle, so the count reads over the video or screen in focus.
    expect(withStyle(more, css.MoreFaces)).toHaveLength(1);
    expect(withStyle(more, css.MoreCount.long)).toHaveLength(0);
  });

  it('counts a long rest in smaller text, so two digits fit the face', () => {
    const crowd = Array.from({ length: 16 }, (_, index) =>
      person(`guest${index}`, { key: `@guest${index}:stage.test:DEVICE` })
    );
    const { container } = showStage({ participants: [{ ...mind, screen: track() }, ...crowd] });
    const more = within(container).getByText('+13');
    expect(more.closest(`.${css.MoreFaces.trim().split(/\s+/).join('.')}`)).not.toBeNull();
    expect(withStyle(container, css.MoreCount.long)).toHaveLength(1);
  });

  it('shows every face in speaker view while there are five or fewer', () => {
    const crowd = Array.from({ length: 4 }, (_, index) =>
      person(`guest${index}`, { key: `@guest${index}:stage.test:DEVICE` })
    );
    const { container } = showStage({ participants: [{ ...mind, screen: track() }, ...crowd] });
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(5);
    expect(within(container).queryByText(/^\+/)).toBeNull();
  });

  it("shows someone on two devices once among speaker view's faces, and not beside their tile", () => {
    const screenShared = showStage({
      participants: [{ ...mind, screen: track() }, ada, onPhone(ada), tom],
    });
    const faces = () =>
      Array.from(
        withStyle(screenShared.container, css.SpeakerFace),
        (face) => (face as HTMLElement).dataset.callTile
      );
    expect(faces()).toEqual([mind.userId, ada.userId, tom.userId]);
    cleanup();

    const { container } = showStage({
      participants: [me, { ...ada, speaking: true, video: track() }, onPhone(ada), tom],
      speakerView: true,
    });
    expect(tileOf(container, ada.userId).querySelector('video')).not.toBeNull();
    expect(container.querySelectorAll(`[data-call-tile="${ada.userId}"]`)).toHaveLength(1);
    expect(
      Array.from(withStyle(container, css.SpeakerFace), (face) => {
        return (face as HTMLElement).dataset.callTile;
      })
    ).toEqual([me.userId, tom.userId]);
  });

  it('switches to speaker view when grid tiles would be under 100 px wide', () => {
    stageSize.width = 300;
    stageSize.height = 120;
    const { container } = showStage({ participants: [me, { ...mind, video: track() }, ada, tom] });

    expect(stageOf(container).hasAttribute('data-speaker-view')).toBe(true);
    expect(container.querySelectorAll('[data-call-tile]')).toHaveLength(4);
  });

  it('tells whether a screen or small tiles force speaker view, whatever the pick', () => {
    const onForcedChange = vi.fn();
    const camera = { ...mind, video: track() };
    const { rerender } = showStage({ participants: [me, camera], onForcedChange });
    expect(onForcedChange).toHaveBeenLastCalledWith(false);

    rerender(
      <CallStage
        room={room}
        speakerView={false}
        microphone
        participants={[me, { ...camera, screen: track() }]}
        onForcedChange={onForcedChange}
      />
    );
    expect(onForcedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <CallStage
        room={room}
        speakerView={false}
        microphone
        participants={[me, camera]}
        onForcedChange={onForcedChange}
      />
    );
    expect(onForcedChange).toHaveBeenLastCalledWith(false);
    cleanup();

    stageSize.width = 300;
    stageSize.height = 120;
    const small = vi.fn();
    showStage({ participants: [me, camera, ada, tom], speakerView: true, onForcedChange: small });
    expect(small).toHaveBeenLastCalledWith(true);
  });
});
