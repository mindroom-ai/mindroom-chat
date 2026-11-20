// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { parseAgentProfile } from './agentProfile';
import type { AgentProfileState } from './useAgentProfile';
import { AgentCapabilities, AgentToolList, WorksIn } from './AgentTools';

const navigateRoom = vi.hoisted(() => vi.fn());
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => ({ navigateRoom }) }));
vi.mock('../../avatars/RoomAvatar', () => ({ RoomAvatar: () => null }));
vi.mock('./MutualRoomsChip', () => ({
  MutualRoomsChip: ({ label }: { label?: string }) => <button type="button">{label}</button>,
}));

afterEach(cleanup);

const CATEGORIES = ['development', 'research', 'productivity', 'email', 'integrations'];
const AVAILABILITY = 'Availability can vary by request and permissions.';

const tools = (entries: Array<[string, string, string?]>) =>
  parseAgentProfile({
    tools: entries.map(([name, category, mcp]) => ({
      name,
      display_name: name,
      description: `About ${name}`,
      category,
      mcp_server: mcp ?? null,
    })),
  })!.tools;

const MANY = tools([
  ...CATEGORIES.map((category, index): [string, string] => [`tool${index}`, category]),
  ['tracker', 'integrations', 'tracker'],
  ['player', 'entertainment'],
  ['shell', 'development'],
  ['weather', 'information'],
]);

const capabilities = (state: AgentProfileState) =>
  render(<AgentCapabilities state={state} onViewAll={vi.fn()} viewAllRef={createRef()} />);

describe('AgentCapabilities', () => {
  it('waits for the profile, and shows nothing without one', () => {
    capabilities({ status: 'loading' });
    expect(screen.getByLabelText('Loading configured tools')).toBeTruthy();
    cleanup();
    const { container } = capabilities({ status: 'none' });
    expect(container.textContent).toBe('');
  });

  it('lists each tool with its whole registry description when there are few', () => {
    capabilities({ status: 'ready', profile: { tools: tools([['Serper', 'research']]) } });
    expect(screen.getByText('Configured tools')).toBeTruthy();
    expect(screen.getByText('1 tool')).toBeTruthy();
    expect(screen.getByText('About Serper')).toBeTruthy();
    expect(screen.getByText(AVAILABILITY)).toBeTruthy();
    expect(screen.queryByText(/View all/)).toBeNull();
  });

  it('shows five groups by their registry category, names the rest, and offers View all', () => {
    capabilities({ status: 'ready', profile: { tools: MANY } });
    expect(screen.getByText('9 tools').parentElement!.textContent).toBe('9 tools · 8 groups');
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Code & filestool0, shell2',
      'Webtool11',
      'Scheduling & memorytool21',
      'Emailtool31',
      'Connected appstracker1',
    ]);
    expect(screen.getByText('Also Integrations, Media, and Information')).toBeTruthy();
    expect(screen.getByRole('button', { name: /View all 9 tools/ })).toBeTruthy();
    expect(screen.getByText(AVAILABILITY)).toBeTruthy();
  });
});

describe('AgentToolList', () => {
  it('filters every tool, opens a description from its name, and goes back', () => {
    const onBack = vi.fn();
    render(<AgentToolList name="Helper" tools={MANY} onBack={onBack} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('region', { name: 'Helper’s tools' })).toBeTruthy();
    expect(screen.getByText(AVAILABILITY)).toBeTruthy();

    const shell = screen.getByRole('button', { name: 'shell' });
    expect(shell.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(shell);
    expect(shell.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('About shell')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'SHE' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Code & files 1',
    ]);
    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'nothing' } });
    expect(screen.getByRole('status').textContent).toBe('No tools match.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('WorksIn', () => {
  it('names the room the card opened in first, one more, then a chip for the rest', () => {
    const room = (roomId: string) => ({
      roomId,
      name: roomId.slice(1, -2),
      getMxcAvatarUrl: () => null,
    });
    const onOpen = vi.fn();
    render(
      <WorksIn
        room={room('!here:x') as unknown as Room}
        shared={{
          spaces: [],
          rooms: ['!other:x', '!here:x', '!third:x'].map(room) as unknown as Room[],
          directs: [room('!dm:x')] as unknown as Room[],
        }}
        onOpen={onOpen}
      />
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'here',
      'other',
      '+2',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(onOpen).toHaveBeenCalled();
    expect(navigateRoom).toHaveBeenCalledWith('!other:x');
  });
});
