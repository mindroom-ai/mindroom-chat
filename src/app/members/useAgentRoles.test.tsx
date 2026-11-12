import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { MINDROOM_SERVER_EVENT } from '../computer/agentServer';
import { useAgentRoles } from './useAgentRoles';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
const ROLE = 'Reviews pull requests and runs the test suite';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

const stateEvent = (
  type: string,
  sender: string,
  content: Record<string, unknown>,
  stateKey = sender
) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender,
    room_id: '!room:example.org',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

const serverState = (sender: string, content: Record<string, unknown>) =>
  stateEvent(MINDROOM_SERVER_EVENT, sender, content);
const joined = (userId: string) => stateEvent('m.room.member', userId, { membership: 'join' });

const roomWith = async (events: MatrixEvent[]) => {
  const mx = createClient({ baseUrl: 'http://localhost:1', userId: viewer });
  const room = new Room('!room:example.org', mx, viewer);
  await room.addLiveEvents(events, { addToState: true });
  return room;
};

const rolesOf = (room: Room) => {
  const seen: Map<string, string>[] = [];
  function Probe() {
    seen.push(useAgentRoles(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return seen;
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('useAgentRoles', () => {
  it('reads the role an agent publishes about itself in its server state', async () => {
    const room = await roomWith([
      joined(agent),
      serverState(agent, { api_origin: 'http://localhost:8765', computer: false, role: ROLE }),
    ]);
    expect(rolesOf(room).at(-1)).toEqual(new Map([[agent, ROLE]]));
  });

  it('follows a role the agent publishes later', async () => {
    const room = await roomWith([joined(agent), serverState(agent, {})]);
    const seen = rolesOf(room);
    expect(seen.at(-1)).toEqual(new Map());
    await act(async () => {
      await room.addLiveEvents([serverState(agent, { role: ROLE })], { addToState: true });
    });
    expect(seen.at(-1)).toEqual(new Map([[agent, ROLE]]));
  });

  it.each([
    ['a person', '@mallory:example.org', { role: 'Room administrator' }],
    [
      'an agent of another homeserver',
      '@mindroom_code:evil.example',
      { role: 'Room administrator' },
    ],
    ['an older runtime, which publishes no role', agent, { api_origin: 'http://localhost:8765' }],
    ['a blank role', agent, { role: '  ' }],
    ['a role that is not text', agent, { role: { text: ROLE } }],
  ])('reads no role from %s', async (_case, sender, content) => {
    const room = await roomWith([joined(sender), serverState(sender, content)]);
    expect(rolesOf(room).at(-1)).toEqual(new Map());
  });
});
