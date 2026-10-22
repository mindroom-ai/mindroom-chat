import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  parseMindroomServer,
  selectMindroomServers,
} from './mindroomServer';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';

const serverEvent = (
  content: Record<string, unknown>,
  {
    sender = agent,
    stateKey = sender,
    ts = 1,
  }: { sender?: string; stateKey?: string; ts?: number } = {}
) =>
  new MatrixEvent({
    type: MINDROOM_SERVER_EVENT,
    state_key: stateKey,
    sender,
    room_id: '!room:example.org',
    event_id: `$server${ts}`,
    origin_server_ts: ts,
    content,
  });

describe('MindRoom server state', () => {
  it('reads the origin and computer an agent publishes about itself', () => {
    expect(
      parseMindroomServer(
        serverEvent({ api_origin: 'http://localhost:8765', computer: true }),
        viewer
      )
    ).toEqual({ agentUserId: agent, apiUrl: 'http://localhost:8765', computer: true, ts: 1 });
    expect(
      parseMindroomServer(serverEvent({ api_origin: 'https://mind.example.org' }), viewer)?.computer
    ).toBe(false);
  });

  it.each([
    [
      'another user',
      serverEvent({ api_origin: 'http://localhost:8765' }, { stateKey: '@mindroom_x:example.org' }),
    ],
    [
      'a user who is not an agent',
      serverEvent({ api_origin: 'http://localhost:8765' }, { sender: '@bob:example.org' }),
    ],
    [
      'an agent on another homeserver',
      serverEvent(
        { api_origin: 'http://localhost:8765' },
        { sender: '@mindroom_code:evil.example' }
      ),
    ],
    ['a public plain HTTP origin', serverEvent({ api_origin: 'http://mind.example.org' })],
    ['an origin with a path', serverEvent({ api_origin: 'https://mind.example.org/app' })],
    ['no origin', serverEvent({})],
  ])('ignores a server described by %s', (_case, event) => {
    expect(parseMindroomServer(event, viewer)).toBeUndefined();
  });

  it('keeps the servers of agents still in the room, newest first', () => {
    const left = '@mindroom_gone:example.org';
    const servers = selectMindroomServers(
      [
        serverEvent({ api_origin: 'http://localhost:8765' }, { ts: 1 }),
        serverEvent({ api_origin: 'https://old.example.org' }, { sender: left, ts: 3 }),
        serverEvent(
          { api_origin: 'https://mind.example.org' },
          { sender: '@mindroom_web:example.org', ts: 2 }
        ),
      ],
      viewer,
      (userId) => userId !== left
    );
    expect(servers.map((server) => server.apiUrl)).toEqual([
      'https://mind.example.org',
      'http://localhost:8765',
    ]);
  });

  it('lists each origin once, newest first', () => {
    const server = (apiUrl: string, ts: number) => ({
      agentUserId: agent,
      apiUrl,
      computer: false,
      ts,
    });
    expect(
      distinctServerUrls([
        server('http://localhost:8765', 1),
        server('https://mind.example.org', 3),
        server('http://localhost:8765', 2),
      ])
    ).toEqual(['https://mind.example.org', 'http://localhost:8765']);
  });
});
