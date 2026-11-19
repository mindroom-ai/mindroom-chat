// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { parseAgentProfile } from './agentProfile';
import type { AgentProfileState } from './useAgentProfile';
import { AgentProfileCard } from './AgentProfileCard';

const state = vi.hoisted(() => ({ current: { status: 'loading' } as AgentProfileState }));
const navigateRoom = vi.hoisted(() => vi.fn());

vi.mock('./useAgentProfile', () => ({ useAgentProfile: () => state.current }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => ({ navigateRoom }) }));
vi.mock('../../avatars/RoomAvatar', () => ({ RoomAvatar: () => null }));
vi.mock('./MutualRoomsChip', () => ({
  MutualRoomsChip: ({ label }: { label?: string }) => <button type="button">{label}</button>,
  useMutualRooms: () => ({
    spaces: [],
    rooms: ['!other:x', '!here:x', '!third:x'].map((roomId) => ({
      roomId,
      name: roomId.slice(1, -2),
      getMxcAvatarUrl: () => null,
    })),
    directs: [{ roomId: '!dm:x', name: 'dm' }],
  }),
}));

const ROOM = { roomId: '!here:x' } as Room;
const CATEGORIES = [
  'development',
  'research',
  'productivity',
  'email',
  'integrations',
  'communication',
  'entertainment',
];

const ready = (tools: Array<[string, string, string?]>): AgentProfileState => ({
  status: 'ready',
  profile: parseAgentProfile({
    model: { config: 'luna', display_name: 'Example Model' },
    tools: tools.map(([name, category, mcp]) => ({
      name,
      display_name: name,
      description: `About ${name}`,
      category,
      mcp_server: mcp ?? null,
    })),
  })!,
});

const renderCard = (role?: string) =>
  render(
    <AgentProfileCard
      room={ROOM}
      userId="@mindroom_helper:x"
      name="Helper"
      avatar={null}
      role={role}
      onMessage={vi.fn()}
      onDone={vi.fn()}
      call={null}
      more={<span>@mindroom_helper:x</span>}
    />
  );

beforeEach(() => {
  state.current = { status: 'loading' };
});
afterEach(cleanup);

describe('AgentProfileCard', () => {
  it('shows the room role and rooms at once, and keeps them when the server has no profile', () => {
    renderCard('Plans the week');
    expect(screen.getByText('Plans the week')).toBeTruthy();
    expect(screen.getByLabelText('Loading what it can do')).toBeTruthy();
    cleanup();
    state.current = { status: 'none' };
    renderCard('Plans the week');
    expect(screen.queryByText('What it can do')).toBeNull();
    expect(screen.queryByLabelText('Loading what it can do')).toBeNull();
    // The room the card opened in comes first, then one more, then a chip for the rest.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'here',
      'other',
      '+2',
      'Message',
      '',
    ]);
  });

  it('lists each tool with its registry description when there are few', () => {
    state.current = ready([
      ['Serper', 'research'],
      ['Agent Memory', 'productivity'],
    ]);
    renderCard();
    expect(screen.getByText('Example Model')).toBeTruthy();
    expect(screen.getByText('2 tools')).toBeTruthy();
    expect(screen.getByText('Serper')).toBeTruthy();
    expect(screen.getByText('About Serper')).toBeTruthy();
    expect(screen.queryByText(/View all/)).toBeNull();
  });

  it('shows five groups, names the rest, and lists every tool behind View all', () => {
    state.current = ready([
      ...CATEGORIES.map((category, index): [string, string] => [`tool${index}`, category]),
      ['tracker', 'integrations', 'tracker'],
      ['shell', 'development'],
    ]);
    renderCard();
    expect(screen.getByText('9 tools · 8 groups')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Write code and work with filestool0, shell2',
      'Search and read the webtool11',
      'Plan, schedule and remembertool21',
      'Read and send emailtool31',
      'Work with connected appstracker1',
    ]);
    expect(screen.getByText('Also Integrations, Chat & messages, and Media')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /View all 9 tools/ }));
    expect(screen.getByRole('heading', { name: 'Helper’s tools' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'SHE' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Code & files 1',
    ]);
    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'nothing' } });
    expect(screen.getByRole('status').textContent).toBe('No tools match.');
    // Message stays under the list.
    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What it can do')).toBeTruthy();
  });

  it('keeps the user ID and moderation under More', () => {
    state.current = { status: 'none' };
    renderCard();
    expect(screen.queryByText('@mindroom_helper:x')).toBeNull();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('@mindroom_helper:x')).toBeTruthy();
  });
});
