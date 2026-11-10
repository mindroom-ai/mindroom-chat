import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  isLoopbackOrigin,
  parseAgentServer,
  selectAgentServers,
  trustedServerOrigins,
  trustedServers,
} from './agentServer';

const agent = '@mindroom_code:example.org';

const server = (apiUrl: string, ts = 1) => ({ agentUserId: agent, apiUrl, computer: false, ts });

const serverEvent = (
  content: Record<string, unknown>,
  { sender = agent, ts = 1 }: { sender?: string; ts?: number } = {}
) =>
  new MatrixEvent({
    type: MINDROOM_SERVER_EVENT,
    state_key: sender,
    sender,
    room_id: '!room:example.org',
    event_id: `$server${ts}`,
    origin_server_ts: ts,
    content,
  });

describe('MindRoom server state', () => {
  it('reads the origin and computer an agent publishes', () => {
    expect(
      parseAgentServer(serverEvent({ api_origin: 'http://localhost:8765', computer: true }))
    ).toEqual({ agentUserId: agent, apiUrl: 'http://localhost:8765', computer: true, ts: 1 });
    expect(
      parseAgentServer(serverEvent({ api_origin: 'https://mind.example.org', computer: 'yes' }))
        ?.computer
    ).toBe(false);
  });

  it.each([
    ['a public plain HTTP origin', { api_origin: 'http://mind.example.org' }],
    ['an origin with a path', { api_origin: 'https://mind.example.org/app' }],
    ['no origin', {}],
  ])('ignores %s', (_case, content) => {
    expect(parseAgentServer(serverEvent(content))).toBeUndefined();
  });

  it('orders the servers newest first', () => {
    const servers = selectAgentServers([
      serverEvent({ api_origin: 'http://localhost:8765' }, { ts: 1 }),
      serverEvent(
        { api_origin: 'https://mind.example.org' },
        { sender: '@mindroom_web:example.org', ts: 2 }
      ),
      serverEvent({}, { sender: '@mindroom_bad:example.org', ts: 3 }),
    ]);
    expect(servers.map((server) => server.apiUrl)).toEqual([
      'https://mind.example.org',
      'http://localhost:8765',
    ]);
  });

  it('lists each origin once, newest first', () => {
    expect(
      distinctServerUrls([
        server('http://localhost:8765', 1),
        server('https://mind.example.org', 3),
        server('http://localhost:8765', 2),
      ])
    ).toEqual(['https://mind.example.org', 'http://localhost:8765']);
  });

  it.each([
    ['http://localhost:8765', true],
    ['http://127.0.0.1:8765', true],
    ['http://[::1]:8765', true],
    ['http://[::ffff:127.0.0.1]:8765', true],
    ['https://localhost.:8765', true],
    ['https://127.example.org', false],
    ['http://192.168.1.50:8765', false],
    ['https://mind.example.org', false],
  ])('tells whether %s is this device', (origin, loopback) => {
    expect(isLoopbackOrigin(origin)).toBe(loopback);
  });
});

describe('trusted MindRoom servers', () => {
  it('trusts the configured server and the listed ones, each read as an origin', () => {
    expect(
      trustedServerOrigins({
        apiUrl: 'https://deployment.example.org/',
        trustedApiUrls: ['https://other.example.org', ' http://localhost:8765 '],
      })
    ).toEqual(
      new Set([
        'https://deployment.example.org',
        'https://other.example.org',
        'http://localhost:8765',
      ])
    );
  });

  it('trusts only the configured server without a list', () => {
    expect(trustedServerOrigins({ apiUrl: 'https://deployment.example.org' })).toEqual(
      new Set(['https://deployment.example.org'])
    );
  });

  it('checks against a list without a configured server, and trusts none from an empty or unusable one', () => {
    expect(trustedServerOrigins({ trustedApiUrls: ['https://other.example.org'] })).toEqual(
      new Set(['https://other.example.org'])
    );
    expect(trustedServerOrigins({ trustedApiUrls: [] })).toEqual(new Set());
    expect(
      trustedServerOrigins({ trustedApiUrls: 'https://other.example.org' as unknown as string[] })
    ).toEqual(new Set());
    expect(
      trustedServerOrigins({
        apiUrl: 'not a url',
        trustedApiUrls: ['http://mind.example.org', 7 as unknown as string],
      })
    ).toEqual(new Set());
  });

  it('has nothing to check against without a configured server or a list', () => {
    expect(trustedServerOrigins(undefined)).toBeUndefined();
    expect(trustedServerOrigins({ apiUrl: '' })).toBeUndefined();
  });

  it('keeps only the published servers on the list', () => {
    const servers = [
      server('https://other.example.org', 2),
      server('https://deployment.example.org'),
    ];
    expect(trustedServers(servers, new Set(['https://deployment.example.org']))).toEqual([
      server('https://deployment.example.org'),
    ]);
    expect(trustedServers(servers, new Set())).toEqual([]);
  });

  it('keeps every published server without a list, and warns once that none is checked', async () => {
    vi.resetModules();
    const fresh = await import('./agentServer');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(fresh.trustedServers([], undefined)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    const servers = [server('https://other.example.org')];
    expect(fresh.trustedServers(servers, undefined)).toBe(servers);
    expect(fresh.trustedServers(servers, undefined)).toBe(servers);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
