// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type FocusTrap from 'focus-trap-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchRoomPicker } from './MessageSearchFilters';

vi.mock('./MessageSearch.css', () => ({
  RoomPicker: 'picker',
  RoomPickerHead: 'head',
  RoomPickerList: 'list',
  RoomPickerNote: 'note',
  RoomPickerName: 'name',
}));
// JSDOM lays nothing out, so every element counts as shown for the trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

type FakeRoom = {
  roomId: string;
  name: string;
  membership?: string;
  space?: boolean;
};

const fakeRooms: FakeRoom[] = [
  { roomId: '!kitchen', name: 'Kitchen' },
  { roomId: '!design', name: 'Design Review' },
  { roomId: '!space', name: 'A space', space: true },
  { roomId: '!left', name: 'Archive', membership: 'leave' },
  { roomId: '!launch', name: 'Launch War Room' },
];
const asSdkRoom = (room: FakeRoom) => ({
  roomId: room.roomId,
  name: room.name,
  getMyMembership: () => room.membership ?? 'join',
  isSpaceRoom: () => !!room.space,
  getJoinRule: () => 'invite',
  getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
});
const client = {
  getRooms: () => fakeRooms.map(asSdkRoom),
  getRoom: (roomId: string) => {
    const room = fakeRooms.find((candidate) => candidate.roomId === roomId);
    return room ? asSdkRoom(room) : null;
  },
};
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const show = (props: Partial<React.ComponentProps<typeof SearchRoomPicker>> = {}) => {
  const onSave = vi.fn();
  act(() =>
    root.render(
      // A new key opens a new picker: an open one keeps the rooms it listed when it opened.
      <SearchRoomPicker
        key={JSON.stringify(props)}
        scopeRooms={['!launch', '!kitchen']}
        everyRoom={false}
        picked={[]}
        onSave={onSave}
        onDismiss={() => undefined}
        {...props}
      />
    )
  );
  return onSave;
};

const rowNames = () =>
  Array.from(host.querySelectorAll('[role="menuitemcheckbox"]')).map((row) => row.textContent);
const button = (name: RegExp) =>
  Array.from(host.querySelectorAll('button')).find((candidate) =>
    name.test(candidate.textContent ?? '')
  ) as HTMLButtonElement;
const type = (text: string) => {
  const input = host.querySelector('input') as HTMLInputElement;
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

it('offers the page rooms by name, or every joined room that holds messages', () => {
  show();
  expect(rowNames()).toEqual(['Kitchen', 'Launch War Room']);
  show({ everyRoom: true });
  expect(rowNames()).toEqual(['Design Review', 'Kitchen', 'Launch War Room']);
});

it('keeps rooms picked earlier on the list and checked', () => {
  show({ picked: ['!design'] });
  expect(rowNames()).toEqual(['Design Review', 'Kitchen', 'Launch War Room']);
  const checked = host.querySelector('[aria-checked="true"]');
  expect(checked?.textContent).toBe('Design Review');
});

it('filters by name and says when nothing matches', () => {
  show({ everyRoom: true });
  type('room');
  expect(rowNames()).toEqual(['Launch War Room']);
  expect(host.textContent).toContain('Rooms for “room”');
  type('zzz');
  expect(rowNames()).toEqual([]);
  expect(host.textContent).toContain('No match found!');
});

it('saves the checked rooms in list order, and nothing after Deselect All', () => {
  const onSave = show({ everyRoom: true });
  const row = (name: string) =>
    Array.from(host.querySelectorAll('[role="menuitemcheckbox"]')).find(
      (candidate) => candidate.textContent === name
    ) as HTMLButtonElement;
  act(() => row('Launch War Room').click());
  act(() => row('Design Review').click());
  expect(button(/^Save/).textContent).toBe('Save (2)');
  act(() => button(/^Save/).click());
  expect(onSave).toHaveBeenLastCalledWith(['!design', '!launch']);

  act(() => button(/^Deselect All$/).click());
  expect(button(/^Save/).textContent).toBe('Save');
  act(() => button(/^Save/).click());
  expect(onSave).toHaveBeenLastCalledWith([]);
});
