// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { createClient, Room, type RoomMember } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nlBase from '../../i18n/locales/nl.json';
import nlAdditions from '../../i18n/locales/additions/nl.json';
import { CrossRoomForkDraftBanner } from './CrossRoomForkDraftBanner';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const membersByRoom = new Map<string, RoomMember[]>();

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../matrix/hooks/useRoomMembers', () => ({
  useRoomMembers: (_client: unknown, roomId: string) => membersByRoom.get(roomId) ?? [],
}));

const makeRoom = (roomId: string, name: string) => {
  const room = new Room(roomId, mx, '@alice:example.org');
  room.name = name;
  return room;
};

const member = (userId: string) => ({ userId, membership: 'join' }) as RoomMember;

afterEach(async () => {
  cleanup();
  membersByRoom.clear();
  if (i18next.language !== 'en') {
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  }
});

describe('CrossRoomForkDraftBanner', () => {
  it('renders cross-room draft details, unshared-agent warning, Back, and layout controls', () => {
    const sourceRoom = makeRoom('!alpha:example.org', 'Project Alpha');
    const targetRoom = makeRoom('!beta:example.org', 'Project Beta');
    membersByRoom.set(sourceRoom.roomId, [member('@alice:example.org')]);
    membersByRoom.set(targetRoom.roomId, [
      member('@alice:example.org'),
      member('@mindroom_coder:example.org'),
    ]);

    const onBack = vi.fn();
    const onShowBeside = vi.fn();
    const onShowFull = vi.fn();

    const { rerender } = render(
      <CrossRoomForkDraftBanner
        sourceRoom={sourceRoom}
        targetRoom={targetRoom}
        onBack={onBack}
        onShowBeside={onShowBeside}
      />
    );

    const banner = document.querySelector('[data-fork-draft-banner="true"]');
    expect(banner?.getAttribute('data-cross-room-fork-banner')).toBe('true');
    expect(screen.getByText('Forking from Project Alpha')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(
      screen.getByText('Not in Project Beta yet. Send a message below to create this thread.')
    ).toBeDefined();
    expect(
      document.querySelector('[data-cross-room-fork-agent-warning="true"]')?.textContent
    ).toContain('Project Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Show the thread beside the messages' }));
    expect(onShowBeside).toHaveBeenCalledTimes(1);

    rerender(
      <CrossRoomForkDraftBanner
        sourceRoom={sourceRoom}
        targetRoom={targetRoom}
        onShowFull={onShowFull}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show the thread in full' }));
    expect(onShowFull).toHaveBeenCalledTimes(1);
  });

  it('omits the agent warning when target agents are also in the source room', () => {
    const sourceRoom = makeRoom('!alpha:example.org', 'Project Alpha');
    const targetRoom = makeRoom('!beta:example.org', 'Project Beta');
    const shared = [member('@alice:example.org'), member('@mindroom_coder:example.org')];
    membersByRoom.set(sourceRoom.roomId, shared);
    membersByRoom.set(targetRoom.roomId, shared);

    render(<CrossRoomForkDraftBanner sourceRoom={sourceRoom} targetRoom={targetRoom} />);

    expect(document.querySelector('[data-cross-room-fork-banner="true"]')).not.toBeNull();
    expect(document.querySelector('[data-cross-room-fork-agent-warning]')).toBeNull();
  });

  it('renders same-room draft copy without cross-room attribute or agent warning', () => {
    const room = makeRoom('!alpha:example.org', 'Project Alpha');
    membersByRoom.set(room.roomId, [
      member('@alice:example.org'),
      member('@mindroom_coder:example.org'),
    ]);

    render(<CrossRoomForkDraftBanner sourceRoom={room} targetRoom={room} />);

    const banner = document.querySelector('[data-fork-draft-banner="true"]');
    expect(banner).not.toBeNull();
    expect(banner?.hasAttribute('data-cross-room-fork-banner')).toBe(false);
    expect(screen.getByText('Forking thread')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(
      screen.getByText('Not created yet. Send a message below to start this forked thread.')
    ).toBeDefined();
    expect(document.querySelector('[data-cross-room-fork-agent-warning]')).toBeNull();
  });

  it('updates visible copy on live language switch from English to Dutch', async () => {
    i18next.addResourceBundle('nl', 'translation', nlBase, true, true);
    i18next.addResourceBundle('nl', 'translation', nlAdditions, true, true);

    const sourceRoom = makeRoom('!alpha:example.org', 'Project Alpha');
    const targetRoom = makeRoom('!beta:example.org', 'Project Beta');

    const { rerender } = render(
      <CrossRoomForkDraftBanner sourceRoom={sourceRoom} targetRoom={targetRoom} />
    );
    expect(screen.getByText('Forking from Project Alpha')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();

    await act(async () => {
      await i18next.changeLanguage('nl');
    });

    expect(screen.getByText('Afsplitsen uit Project Alpha')).toBeDefined();
    expect(screen.getByText('Concept')).toBeDefined();
    expect(
      screen.getByText(
        'Nog niet in Project Beta. Stuur hieronder een bericht om deze thread aan te maken.'
      )
    ).toBeDefined();

    rerender(<CrossRoomForkDraftBanner sourceRoom={sourceRoom} targetRoom={sourceRoom} />);
    expect(screen.getByText('Thread afsplitsen')).toBeDefined();
    expect(
      screen.getByText(
        'Nog niet aangemaakt. Stuur hieronder een bericht om deze afgesplitste thread te starten.'
      )
    ).toBeDefined();
  });
});
