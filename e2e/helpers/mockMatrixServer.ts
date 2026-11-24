import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export type MatrixEventJson = {
  type: string;
  event_id: string;
  sender: string;
  origin_server_ts: number;
  room_id: string;
  content: Record<string, unknown>;
  state_key?: string;
};

export type MockMatrixServerOptions = {
  roomId?: string;
  roomName?: string;
  userId?: string;
  otherUserId?: string;
  otherDisplayName?: string;
};

export const startMockMatrixServer = async (
  initialEvents: MatrixEventJson[],
  {
    roomId = '!canvas:localhost',
    roomName = 'Canvas Policy Room',
    userId = '@e2e:localhost',
    otherUserId = '@mindroom_agent:localhost',
    otherDisplayName = 'Agent',
  }: MockMatrixServerOptions = {}
) => {
  const events: MatrixEventJson[] = [...initialEvents];
  let probeHits = 0;
  const waiters: Array<() => void> = [];
  const sockets = new Set<Duplex>();

  const notify = () => {
    for (const wake of waiters.splice(0)) wake();
  };

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/canvas-probe') {
      probeHits += 1;
      json(200, { leaked: true });
      return;
    }
    if (url.pathname === '/_matrix/client/versions') {
      json(200, { versions: ['v1.11'] });
      return;
    }
    if (url.pathname.endsWith('/account/whoami')) {
      json(200, { user_id: userId, device_id: 'E2EDEVICE' });
      return;
    }
    if (url.pathname.includes('/filter') && req.method === 'POST') {
      json(200, { filter_id: 'f1' });
      return;
    }
    if (url.pathname.includes('/profile/')) {
      const requested = decodeURIComponent(url.pathname.split('/profile/')[1]?.split('/')[0] ?? '');
      json(200, { displayname: requested === otherUserId ? otherDisplayName : 'Tester' });
      return;
    }
    if (url.pathname.endsWith('/pushrules/')) {
      json(200, { global: {} });
      return;
    }
    if (url.pathname.endsWith('/room_keys/version')) {
      json(404, { errcode: 'M_NOT_FOUND', error: 'No backup' });
      return;
    }
    if (url.pathname.endsWith('/keys/query')) {
      json(200, { device_keys: {}, failures: {} });
      return;
    }
    if (url.pathname.endsWith('/keys/upload')) {
      json(200, { one_time_key_counts: {} });
      return;
    }
    if (url.pathname.includes('/event/')) {
      const id = decodeURIComponent(url.pathname.split('/event/')[1] ?? '');
      const found = events.find((ev) => ev.event_id === id);
      if (found) json(200, found);
      else json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
      return;
    }
    if (url.pathname.includes('/messages')) {
      json(200, { chunk: [...events].reverse(), start: 's0', end: 'e0' });
      return;
    }
    if (url.pathname.includes('/relations/')) {
      const parts = url.pathname.split('/relations/')[1]?.split('/') ?? [];
      const targetId = decodeURIComponent(parts[0] ?? '');
      const relType = parts[1] ? decodeURIComponent(parts[1]) : undefined;
      const matched = events.filter((ev) => {
        const rel = ev.content['m.relates_to'] as
          { rel_type?: string; event_id?: string } | undefined;
        return rel?.event_id === targetId && (!relType || rel.rel_type === relType);
      });
      json(200, { chunk: matched.reverse() });
      return;
    }
    if (url.pathname.includes('/context/')) {
      const id = decodeURIComponent(url.pathname.split('/context/')[1] ?? '');
      const found = events.find((ev) => ev.event_id === id) ?? events[0];
      json(200, {
        event: found,
        events_before: [],
        events_after: [],
        start: 's0',
        end: 'e0',
        state: [],
      });
      return;
    }
    if (url.pathname.endsWith('/sync')) {
      const sinceRaw = url.searchParams.get('since');
      const since = sinceRaw ? Number.parseInt(sinceRaw, 10) : 0;
      const answer = () => {
        if (since === 0) {
          const now = Date.now();
          const state: MatrixEventJson[] = [
            {
              type: 'm.room.create',
              event_id: '$st_create',
              sender: otherUserId,
              origin_server_ts: now - 10_000,
              room_id: roomId,
              state_key: '',
              content: { room_version: '11', creator: otherUserId },
            },
            {
              type: 'm.room.name',
              event_id: '$st_name',
              sender: otherUserId,
              origin_server_ts: now - 9_000,
              room_id: roomId,
              state_key: '',
              content: { name: roomName },
            },
            {
              type: 'm.room.member',
              event_id: '$st_user',
              sender: userId,
              origin_server_ts: now - 8_000,
              room_id: roomId,
              state_key: userId,
              content: { membership: 'join', displayname: 'Tester' },
            },
            {
              type: 'm.room.member',
              event_id: '$st_other',
              sender: otherUserId,
              origin_server_ts: now - 7_000,
              room_id: roomId,
              state_key: otherUserId,
              content: { membership: 'join', displayname: otherDisplayName },
            },
          ];
          json(200, {
            next_batch: String(events.length),
            rooms: {
              join: {
                [roomId]: {
                  state: { events: state },
                  timeline: { events, limited: false, prev_batch: 'p0' },
                  ephemeral: { events: [] },
                  account_data: { events: [] },
                  unread_notifications: { highlight_count: 0, notification_count: 0 },
                },
              },
            },
          });
          return;
        }
        const delta = events.slice(since);
        json(200, {
          next_batch: String(events.length),
          rooms: delta.length
            ? {
                join: {
                  [roomId]: {
                    state: { events: [] },
                    timeline: { events: delta, limited: false },
                    ephemeral: { events: [] },
                    account_data: { events: [] },
                  },
                },
              }
            : { join: {} },
        });
      };

      if (since === 0 || events.length > since) {
        answer();
        return;
      }
      const timer = setTimeout(answer, 1_500);
      const wake = () => {
        clearTimeout(timer);
        answer();
      };
      waiters.push(wake);
      req.on('close', () => {
        clearTimeout(timer);
        const idx = waiters.indexOf(wake);
        if (idx >= 0) waiters.splice(idx, 1);
      });
      return;
    }
    json(200, {});
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pushEvent: (event: MatrixEventJson) => {
      events.push(event);
      notify();
    },
    probeHits: () => probeHits,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
