// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { SpaceRoomFilter } from './SpaceRoomFilter';
import {
  toggleSpaceRoomGroupSelection,
  toggleSpaceRoomSelection,
  type SpaceRoomFilterGroups,
  type SpaceRoomItem,
} from './spaceThreadsModel';

const ROOM_ENG = '!eng:example.org';
const ROOM_DES = '!des:example.org';
const ROOM_OPS = '!ops:example.org';
const SUB_PLATFORM = '!sub-platform:example.org';

type StubRoom = Room & { setName: (next: string) => void };

const makeRoom = (
  roomId: string,
  initialName: string,
  opts: {
    avatarMxc?: string;
    joinRule?: string;
    directPartner?: { userId: string; avatarMxc?: string };
  } = {}
): StubRoom => {
  let name = initialName;
  return {
    roomId,
    get name() {
      return name;
    },
    getMxcAvatarUrl: () => opts.avatarMxc ?? null,
    getJoinRule: () => opts.joinRule ?? 'invite',
    getAvatarFallbackMember: () =>
      opts.directPartner
        ? {
            userId: opts.directPartner.userId,
            getMxcAvatarUrl: () => opts.directPartner?.avatarMxc ?? null,
          }
        : null,
    setName: (next: string) => {
      name = next;
    },
  } as unknown as StubRoom;
};

const makeClient = (): MatrixClient =>
  ({
    getHomeserverUrl: () => 'https://example.org',
    mxcUrlToHttp: (mxc: string) =>
      mxc ? mxc.replace('mxc://', 'https://example.org/_matrix/media/v3/download/') : null,
  }) as unknown as MatrixClient;

const openDropdown = (container: HTMLElement) => {
  if (!container.querySelector('[data-room-filter-panel]')) {
    fireEvent.click(container.querySelector('[data-room-filter-button]')!);
  }
};

afterEach(() => {
  cleanup();
});

describe('SpaceRoomFilter', () => {
  it('renders room avatar images, DM partner avatars/initials, and RoomIcon fallbacks', () => {
    const dmWithAvatarId = '!dm-avatar:example.org';
    const dmInitialsId = '!dm-initials:example.org';
    const rooms: SpaceRoomItem[] = [
      {
        room: makeRoom(ROOM_ENG, 'Engineering', { avatarMxc: 'mxc://example.org/eng-avatar' }),
        name: 'Engineering',
        accentColor: '#4f8ff7',
      },
      {
        room: makeRoom(ROOM_DES, 'Design', { joinRule: 'public' }),
        name: 'Design',
        accentColor: '#2aa89b',
      },
      {
        room: makeRoom(dmWithAvatarId, 'Alice', {
          directPartner: { userId: '@alice:example.org', avatarMxc: 'mxc://example.org/alice' },
        }),
        name: 'Alice',
        accentColor: '#3ba66b',
      },
      {
        room: makeRoom(dmInitialsId, 'Bob Builder', {
          directPartner: { userId: '@bob:example.org' },
        }),
        name: 'Bob Builder',
        accentColor: '#d99026',
      },
    ];
    const store = createStore();
    store.set(mDirectAtom, {
      type: 'INITIALIZE',
      rooms: new Set([dmWithAvatarId, dmInitialsId]),
    });

    const { container } = render(
      <Provider store={store}>
        <MatrixClientProvider value={makeClient()}>
          <SpaceRoomFilter
            rooms={rooms}
            roomCounts={new Map()}
            selectedRoomIds={undefined}
            onToggleRoom={vi.fn()}
            onSelectAll={vi.fn()}
          />
        </MatrixClientProvider>
      </Provider>
    );
    openDropdown(container);

    const engRow = container.querySelector<HTMLElement>(`[data-room-option="${ROOM_ENG}"]`)!;
    expect(engRow.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/eng-avatar'
    );

    const desRow = container.querySelector<HTMLElement>(`[data-room-option="${ROOM_DES}"]`)!;
    expect(desRow.querySelector('img')).toBeNull();
    expect(desRow.querySelector(`[data-avatar-fallback-id="${ROOM_DES}"] svg`)).toBeTruthy();

    const dmAvatarRow = container.querySelector<HTMLElement>(
      `[data-room-option="${dmWithAvatarId}"]`
    )!;
    expect(dmAvatarRow.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/alice'
    );

    const dmInitRow = container.querySelector<HTMLElement>(`[data-room-option="${dmInitialsId}"]`)!;
    expect(dmInitRow.querySelector('img')).toBeNull();
    expect(
      dmInitRow.querySelector('[data-avatar-fallback-id="@bob:example.org"]')?.textContent
    ).toBe('B');
  });

  it('supports subspace checkboxes, indeterminate state, trigger label, search, and rename freshness', () => {
    const subRoom = makeRoom(SUB_PLATFORM, 'Platform');
    const items: SpaceRoomItem[] = [
      { room: makeRoom(ROOM_ENG, 'Engineering'), name: 'Engineering', accentColor: '#4f8ff7' },
      { room: makeRoom(ROOM_DES, 'Design'), name: 'Design', accentColor: '#2aa89b' },
      { room: makeRoom(ROOM_OPS, 'Ops'), name: 'Ops', accentColor: '#3ba66b' },
    ];
    const allIds = items.map((item) => item.room.roomId);
    const counts = new Map([
      [ROOM_ENG, 1],
      [ROOM_DES, 2],
      [ROOM_OPS, 3],
    ]);
    const groups: SpaceRoomFilterGroups = {
      rootRoomIds: [ROOM_ENG],
      subspaces: [
        {
          spaceId: SUB_PLATFORM,
          room: subRoom,
          depth: 1,
          directRoomIds: [ROOM_DES, ROOM_OPS],
          subtreeRoomIds: [ROOM_DES, ROOM_OPS],
        },
      ],
    };

    function Harness() {
      const [selected, setSelected] = useState<Set<string> | undefined>(undefined);
      return (
        <SpaceRoomFilter
          rooms={items}
          roomCounts={counts}
          selectedRoomIds={selected}
          groups={groups}
          onSelectAll={() => setSelected(undefined)}
          onToggleRoom={(id) => setSelected((cur) => toggleSpaceRoomSelection(cur, id, allIds))}
          onToggleRoomGroup={(ids) =>
            setSelected((cur) => toggleSpaceRoomGroupSelection(cur, ids, allIds))
          }
        />
      );
    }

    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    const { container } = render(
      <Provider store={store}>
        <MatrixClientProvider value={makeClient()}>
          <Harness />
        </MatrixClientProvider>
      </Provider>
    );

    openDropdown(container);
    const getSubspaceCheckbox = () =>
      within(
        container.querySelector<HTMLElement>(`[data-subspace-option="${SUB_PLATFORM}"]`)!
      ).getByRole<HTMLInputElement>('checkbox');
    const toggleRoom = (roomId: string) =>
      fireEvent.click(
        within(container.querySelector<HTMLElement>(`[data-room-option="${roomId}"]`)!).getByRole(
          'checkbox'
        )
      );

    expect(
      container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)?.textContent
    ).toContain('Platform');
    expect(
      container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)?.textContent
    ).toContain('5');
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('false');

    // Checking Platform selects Design + Ops and labels the trigger "Platform".
    fireEvent.click(getSubspaceCheckbox());
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Platform');
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('true');

    // Unchecking Design makes Platform indeterminate (aria-checked="mixed").
    toggleRoom(ROOM_DES);
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Ops');
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('mixed');
    expect(getSubspaceCheckbox().indeterminate).toBe(true);

    // Clicking indeterminate Platform re-checks all rooms in Platform.
    fireEvent.click(getSubspaceCheckbox());
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Platform');
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('true');

    // Clicking checked Platform unchecks its rooms and restores "Rooms".
    fireEvent.click(getSubspaceCheckbox());
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Rooms');

    // Search matches subspace name (shows subspace + rooms) and room name (keeps ancestor header).
    const search = container.querySelector<HTMLInputElement>('[data-room-filter-search]')!;
    fireEvent.change(search, { target: { value: 'plat' } });
    expect(container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_DES}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_ENG}"]`)).toBeNull();

    fireEvent.change(search, { target: { value: 'ops' } });
    expect(container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_DES}"]`)).toBeNull();

    // Renaming the subspace updates its label and search match on dropdown reopen.
    fireEvent.click(container.querySelector('[data-room-filter-button]')!);
    subRoom.setName('Infrastructure');
    openDropdown(container);
    expect(
      container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)?.textContent
    ).toContain('Infrastructure');
    fireEvent.change(container.querySelector<HTMLInputElement>('[data-room-filter-search]')!, {
      target: { value: 'infra' },
    });
    expect(container.querySelector(`[data-subspace-option="${SUB_PLATFORM}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
  });
});
