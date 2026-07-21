// @vitest-environment jsdom
/**
 * Call-start surface behavior for a retired room: `createCallEmbed` throws
 * once a room's destructive teardown has
 * started, and that throw happens inside an ordinary click handler. The
 * surface must consume it — no uncaught exception, no embed published.
 */
import React, { ReactNode } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  room: { roomId: '!retired-prescreen:mindroom.test' },
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

// The real useTheme drags in vanilla-extract styles that cannot load in vitest.
vi.mock('../../hooks/useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

vi.mock('../../hooks/useCall', () => ({
  useCallSession: () => undefined,
  useCallMembers: () => [],
  useCallMembersChange: () => undefined,
}));

vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => mocks.room,
  useIsDirectRoom: () => false,
}));

vi.mock('../../state/hooks/callPreferences', () => ({
  useCallPreferences: () => ({
    microphone: true,
    video: false,
    sound: true,
    toggleMicrophone: vi.fn(),
    toggleVideo: vi.fn(),
    toggleSound: vi.fn(),
  }),
}));

vi.mock('./styles.css', () => ({
  ControlCard: 'control-card',
}));

vi.mock('./Controls', () => ({
  ChatButton: () => null,
  ControlDivider: () => null,
  MicrophoneButton: () => null,
  SoundButton: () => null,
  VideoButton: () => null,
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('folds', () => ({
  Box: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  Button: ({
    children,
    before,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    before?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) =>
    React.createElement(
      'button',
      { 'data-mock': 'folds-button', disabled, onClick },
      before,
      children
    ),
  Icon: () => null,
  Icons: new Proxy({}, { get: (_target, prop) => String(prop) }),
  Spinner: () => null,
  Text: ({ children }: { children?: ReactNode }) => React.createElement('span', null, children),
  color: new Proxy({}, { get: () => new Proxy({}, { get: (_target, prop) => String(prop) }) }),
}));

/* eslint-disable import/first */
import { retireCallRoom } from '../../plugins/call/rtcMembershipCleanup';
import {
  CALL_ROOM_RETIRED_USER_MESSAGE,
  CallEmbedRefContextProvider,
} from '../../hooks/useCallEmbed';
import { PrescreenControls } from './PrescreenControls';
/* eslint-enable import/first */

const renderPrescreen = (embedRef: React.RefObject<HTMLDivElement>): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <CallEmbedRefContextProvider value={embedRef}>
        <PrescreenControls canJoin />
      </CallEmbedRefContextProvider>
    );
  });
  return renderer;
};

const findJoinButton = (renderer: ReactTestRenderer) => {
  const buttons = renderer.root.findAll((node) => node.props['data-mock'] === 'folds-button');
  expect(buttons).toHaveLength(1);
  return buttons[0];
};

const renderedText = (renderer: ReactTestRenderer): string =>
  JSON.stringify(renderer.toJSON() ?? '');

describe('PrescreenControls on a retired room', () => {
  it('refuses proactively: Join disabled and the retirement message shown', () => {
    // A retired room stays reachable when its post-End leave failed or has
    // not landed yet; the surface must say why joining is off the table.
    retireCallRoom(mocks.room.roomId);
    const container = document.createElement('div');
    const embedRef = { current: container } as React.RefObject<HTMLDivElement>;
    const renderer = renderPrescreen(embedRef);

    try {
      expect(findJoinButton(renderer).props.disabled).toBe(true);
      expect(renderedText(renderer)).toContain(CALL_ROOM_RETIRED_USER_MESSAGE);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('reacts immediately when its room retires after the prescreen mounted', () => {
    const lateRetiredRoomId = '!late-retired-prescreen:mindroom.test';
    mocks.room.roomId = lateRetiredRoomId;
    const container = document.createElement('div');
    const embedRef = { current: container } as React.RefObject<HTMLDivElement>;
    const renderer = renderPrescreen(embedRef);
    try {
      expect(findJoinButton(renderer).props.disabled).toBe(false);
      expect(renderedText(renderer)).not.toContain(CALL_ROOM_RETIRED_USER_MESSAGE);

      act(() => {
        retireCallRoom(lateRetiredRoomId);
      });

      expect(findJoinButton(renderer).props.disabled).toBe(true);
      expect(renderedText(renderer)).toContain(CALL_ROOM_RETIRED_USER_MESSAGE);
      expect(container.childElementCount).toBe(0);
    } finally {
      act(() => renderer.unmount());
      mocks.room.roomId = '!retired-prescreen:mindroom.test';
    }
  });

  it('consumes a click-time refusal if retirement wins the render-to-click race', () => {
    const raceRetiredRoomId = '!race-retired-prescreen:mindroom.test';
    mocks.room.roomId = raceRetiredRoomId;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const container = document.createElement('div');
    const embedRef = { current: container } as React.RefObject<HTMLDivElement>;
    const renderer = renderPrescreen(embedRef);
    const handleJoin = findJoinButton(renderer).props.onClick;
    try {
      act(() => {
        retireCallRoom(raceRetiredRoomId);
        handleJoin();
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][1])).toContain('shutting down');
      expect(renderedText(renderer)).toContain(CALL_ROOM_RETIRED_USER_MESSAGE);
      expect(container.childElementCount).toBe(0);
    } finally {
      act(() => renderer.unmount());
      warn.mockRestore();
      mocks.room.roomId = '!retired-prescreen:mindroom.test';
    }
  });
});
