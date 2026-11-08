// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, within } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import { CallStage } from './CallStage';
import * as css from './CallStage.css';

const NAMES: Record<string, string> = {
  '@me:stage.test': 'Me',
  '@mind:stage.test': 'Mind',
  '@ada:stage.test': 'Ada',
  '@tom:stage.test': 'Tom',
  '@mindroom_helper:stage.test': 'Helper',
};

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ mxcUrlToHttp: () => null }),
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/room')>()),
  getMemberDisplayName: (_room: Room, userId: string) => NAMES[userId],
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
// A MindRoom agent, by its user name.
const helper = person('mindroom_helper');

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

  it("shows someone else's screen while this device shares one too", () => {
    const { container } = showStage({
      participants: [
        { ...me, screen: track() },
        { ...mind, screen: track() },
      ],
    });

    expect(container.querySelector(`[data-call-screen="${mind.userId}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-call-screen="${me.userId}"]`)).toBeNull();
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
    cleanup();

    stageSize.width = 300;
    stageSize.height = 120;
    const small = vi.fn();
    showStage({ participants: [me, camera, ada, tom], speakerView: true, onForcedChange: small });
    expect(small).toHaveBeenLastCalledWith(true);
  });
});
