import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  chatUrl,
  deleteInvite,
  invitableRooms,
  invitationText,
  inviteAddresses,
  inviteErrorText,
  listInvites,
  parseAddresses,
  parseInvite,
  roomLabel,
  ssoProviderNames,
  supportsRegistrationInvites,
} from './invites';

const PREFIX = { prefix: '/_matrix/client/unstable/io.mindroom' };

const matrixError = (errcode: string, error: string) =>
  Object.assign(new Error(`MatrixError: [400] ${error}`), {
    errcode,
    httpStatus: 400,
    data: { errcode, error },
  });

type Answer = (method: string, path: string, body: unknown) => unknown;

const clientWith = (answer: Answer) => {
  const authedRequest = vi.fn(
    async (method: string, path: string, _query: unknown, body: unknown) =>
      answer(method, path, body)
  );
  const client = {
    http: { authedRequest },
    getHomeserverUrl: () => 'https://matrix.example.com/',
  };
  return { client: client as unknown as MatrixClient, authedRequest };
};

const versionsFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

// The translation's key, with what it was given.
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;

describe('supportsRegistrationInvites', () => {
  it('is true only when /versions lists the feature', async () => {
    const { client } = clientWith(() => ({}));
    const listed = versionsFetch({
      versions: ['v1.11'],
      unstable_features: { 'io.mindroom.registration_invites': true },
    });

    expect(await supportsRegistrationInvites(client, listed)).toBe(true);
    expect(listed).toHaveBeenCalledWith(
      'https://matrix.example.com/_matrix/client/versions',
      expect.objectContaining({ method: 'GET' })
    );
    expect(
      await supportsRegistrationInvites(
        client,
        versionsFetch({
          versions: ['v1.11'],
          unstable_features: { 'io.mindroom.registration_invites': false },
        })
      )
    ).toBe(false);
    expect(await supportsRegistrationInvites(client, versionsFetch({ versions: ['v1.11'] }))).toBe(
      false
    );
  });

  it('is false, without an error, when the server cannot be asked', async () => {
    const { client } = clientWith(() => ({}));
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    expect(await supportsRegistrationInvites(client, offline)).toBe(false);
    expect(await supportsRegistrationInvites(client, versionsFetch({}, 500))).toBe(false);
  });
});

describe('parseInvite and listInvites', () => {
  it('reads an invite, and nothing from what is none', () => {
    expect(
      parseInvite({ email: 'alice@example.com', rooms: ['!lobby:example.com', 7], external: true })
    ).toEqual({ email: 'alice@example.com', rooms: ['!lobby:example.com'], external: true });
    expect(parseInvite({ email: 'bob@example.com' })).toEqual({
      email: 'bob@example.com',
      rooms: [],
      external: false,
    });
    expect(parseInvite({ rooms: [] })).toBeUndefined();
    expect(parseInvite('alice@example.com')).toBeUndefined();
  });

  it('lists the invites the server answers with', async () => {
    const { client, authedRequest } = clientWith(() => ({
      invites: [{ email: 'alice@example.com', rooms: [], external: true }, { rooms: [] }],
    }));

    expect(await listInvites(client)).toEqual([
      { email: 'alice@example.com', rooms: [], external: true },
    ]);
    expect(authedRequest).toHaveBeenCalledWith(
      'GET',
      '/admin/registration_invites',
      undefined,
      undefined,
      PREFIX
    );
  });
});

describe('parseAddresses', () => {
  it('splits pasted addresses at commas, semicolons and white space', () => {
    expect(
      parseAddresses(' alice@example.com, bob@example.com\ncarol@example.com;dave@example.com\r\n')
    ).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com', 'dave@example.com']);
    expect(parseAddresses(' ,\n')).toEqual([]);
  });

  it('keeps an address once, whatever its case', () => {
    expect(parseAddresses('Alice@example.com, alice@EXAMPLE.com, bob@example.com')).toEqual([
      'Alice@example.com',
      'bob@example.com',
    ]);
  });

  it('takes the address out of the forms a mail program writes it in', () => {
    expect(parseAddresses('"Alice Smith" <alice@example.com>')).toEqual(['alice@example.com']);
    expect(parseAddresses('mailto:alice@example.com')).toEqual(['alice@example.com']);
    expect(parseAddresses('alice@example.com.')).toEqual(['alice@example.com']);
    expect(
      parseAddresses(
        '"Smith, Alice" <alice@example.com>; Bob Jones <bob@example.com>,\n(carol@example.com), <mailto:dave@example.com>'
      )
    ).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com', 'dave@example.com']);
  });

  it('keeps what is no address, so that the form can say so', () => {
    expect(parseAddresses('alice.example.com bob@example.com Carol')).toEqual([
      'alice.example.com',
      'bob@example.com',
      'Carol',
    ]);
  });
});

describe('inviteAddresses', () => {
  it('sends one request per address and answers with each result, in order', async () => {
    const refused = matrixError(
      'M_THREEPID_IN_USE',
      'That email address already belongs to @bob:example.com.'
    );
    const { client, authedRequest } = clientWith((_method, path, body) => {
      if (path.endsWith('/bob%40example.com')) throw refused;
      return { email: 'alice+chat@example.com', ...(body as object) };
    });

    const results = await inviteAddresses(
      client,
      ['Alice+Chat@example.com', 'bob@example.com'],
      ['!lobby:example.com'],
      true
    );

    expect(results).toEqual([
      {
        address: 'Alice+Chat@example.com',
        invite: { email: 'alice+chat@example.com', rooms: ['!lobby:example.com'], external: true },
      },
      { address: 'bob@example.com', error: refused },
    ]);
    expect(authedRequest.mock.calls).toEqual([
      [
        'PUT',
        '/admin/registration_invites/Alice%2BChat%40example.com',
        undefined,
        { rooms: ['!lobby:example.com'], external: true },
        PREFIX,
      ],
      [
        'PUT',
        '/admin/registration_invites/bob%40example.com',
        undefined,
        { rooms: ['!lobby:example.com'], external: true },
        PREFIX,
      ],
    ]);
  });
});

describe('inviteAddresses, given what is no address', () => {
  it('says so itself, and sends nothing for it', async () => {
    const { client, authedRequest } = clientWith((_method, _path, body) => ({
      email: 'alice@example.com',
      ...(body as object),
    }));

    const results = await inviteAddresses(
      client,
      ['Carol', 'alice@example.com', '@example.com', 'alice@'],
      [],
      false
    );

    expect(results.map(({ address, invite }) => [address, invite?.email])).toEqual([
      ['Carol', undefined],
      ['alice@example.com', 'alice@example.com'],
      ['@example.com', undefined],
      ['alice@', undefined],
    ]);
    expect(inviteErrorText(t, results[0]?.error)).toBe(
      'serverAccounts.invites.errors.invalidAddress'
    );
    expect(authedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('deleteInvite', () => {
  it('deletes the invite of the address', async () => {
    const { client, authedRequest } = clientWith(() => ({}));

    await deleteInvite(client, 'alice@example.com');

    expect(authedRequest).toHaveBeenCalledWith(
      'DELETE',
      '/admin/registration_invites/alice%40example.com',
      undefined,
      undefined,
      PREFIX
    );
  });

  it('is done when the invite is gone already, and fails on any other refusal', async () => {
    const gone = clientWith(() => {
      throw matrixError('M_NOT_FOUND', 'That email address has no registration invite.');
    });
    const forbidden = matrixError('M_FORBIDDEN', 'You are not a server admin.');
    const refused = clientWith(() => {
      throw forbidden;
    });

    await expect(deleteInvite(gone.client, 'alice@example.com')).resolves.toBeUndefined();
    await expect(deleteInvite(refused.client, 'alice@example.com')).rejects.toBe(forbidden);
  });
});

describe('inviteErrorText', () => {
  it('names the account that already has the address', () => {
    expect(
      inviteErrorText(
        t,
        matrixError('M_THREEPID_IN_USE', 'That email address already belongs to @bob:example.com.')
      )
    ).toBe('serverAccounts.invites.errors.inUse {"user":"@bob:example.com"}');
  });

  it('says that an address is malformed', () => {
    expect(inviteErrorText(t, matrixError('M_INVALID_PARAM', 'Invalid email address'))).toBe(
      'serverAccounts.invites.errors.invalidAddress'
    );
  });

  it("falls back to the app's text for the error", () => {
    expect(inviteErrorText(t, matrixError('M_THREEPID_IN_USE', 'Taken.'))).toBe(
      'errors.addressTaken'
    );
    expect(inviteErrorText(t, matrixError('M_FORBIDDEN', 'You are not a server admin.'))).toBe(
      'errors.forbidden'
    );
  });
});

describe('ssoProviderNames', () => {
  it('names the identity providers of the single sign-on flow', async () => {
    const loginFlows = vi.fn(async () => ({
      flows: [
        { type: 'm.login.password' },
        {
          type: 'm.login.sso',
          identity_providers: [
            { id: 'a', name: 'Example ID' },
            { id: 'b' },
            { id: 'c', name: 'github', brand: 'github' },
          ],
        },
      ],
    }));

    // The homeserver writes a brand in lowercase; a known one gets its own spelling.
    expect(await ssoProviderNames({ loginFlows } as unknown as MatrixClient)).toEqual([
      'Example ID',
      'GitHub',
    ]);
  });

  it('names a provider once', async () => {
    const loginFlows = vi.fn(async () => ({
      flows: [
        {
          type: 'm.login.sso',
          identity_providers: [
            { id: 'a', name: 'google' },
            { id: 'b', name: 'Google' },
            { id: 'c', name: 'Example ID' },
          ],
        },
      ],
    }));

    expect(await ssoProviderNames({ loginFlows } as unknown as MatrixClient)).toEqual([
      'Google',
      'Example ID',
    ]);
  });

  it('names none when the server lists none or cannot be asked', async () => {
    const none = vi.fn(async () => ({ flows: [{ type: 'm.login.password' }] }));
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });

    expect(await ssoProviderNames({ loginFlows: none } as unknown as MatrixClient)).toEqual([]);
    expect(await ssoProviderNames({ loginFlows: failing } as unknown as MatrixClient)).toEqual([]);
  });
});

describe('chatUrl', () => {
  it('is where the app is served', () => {
    expect(chatUrl('https://chat.example.com')).toBe('https://chat.example.com/');
  });
});

describe('invitationText', () => {
  it('names the address, where to sign in and with which provider', () => {
    expect(
      invitationText(t, 'en', {
        url: 'https://chat.example.com/',
        providers: ['Example ID', 'Other ID'],
        email: 'alice@example.com',
      })
    ).toBe(
      'serverAccounts.invites.message {"url":"https://chat.example.com/","providers":"Example ID or Other ID","email":"alice@example.com"}'
    );
  });

  it('leaves the provider out when none is known', () => {
    expect(
      invitationText(t, 'en', {
        url: 'https://chat.example.com/',
        providers: [],
        email: 'alice@example.com',
      })
    ).toBe(
      'serverAccounts.invites.messagePlain {"url":"https://chat.example.com/","email":"alice@example.com"}'
    );
  });
});

describe('invitableRooms', () => {
  type RoomOptions = { membership?: string; alias?: string; tombstone?: boolean; space?: boolean };
  const room = (roomId: string, name: string, options: RoomOptions = {}) => ({
    roomId,
    name,
    getMyMembership: () => options.membership ?? 'join',
    getCanonicalAlias: () => options.alias ?? null,
    isSpaceRoom: () => options.space === true,
    currentState: {
      getStateEvents: (type: string, key: string) =>
        options.tombstone === true && type === 'm.room.tombstone' && key === '' ? {} : null,
    },
  });
  const getDomain = () => 'example.com';

  it("lists the joined rooms by name, without direct chats and the server's admin room", () => {
    const getRooms = () => [
      room('!lobby:example.com', 'Lobby', { alias: '#lobby:example.com' }),
      room('!admins:example.com', 'Admin Room', { alias: '#admins:example.com' }),
      room('!dm:example.com', 'Bob'),
      room('!invited:example.com', 'Invited', { membership: 'invite' }),
      room('!class:example.com', 'class'),
    ];

    expect(
      invitableRooms(
        { getRooms, getDomain } as unknown as MatrixClient,
        new Set(['!dm:example.com'])
      )
    ).toEqual([
      { roomId: '!class:example.com', name: 'class', address: '!class:example.com' },
      { roomId: '!lobby:example.com', name: 'Lobby', address: '#lobby:example.com' },
    ]);
  });

  it('leaves out a room an upgrade replaced, which the server lets no registration join', () => {
    const getRooms = () => [
      room('!old:example.com', 'Lobby', { tombstone: true }),
      room('!new:example.com', 'Lobby', { alias: '#lobby:example.com' }),
    ];

    expect(invitableRooms({ getRooms, getDomain } as unknown as MatrixClient, new Set())).toEqual([
      { roomId: '!new:example.com', name: 'Lobby', address: '#lobby:example.com' },
    ]);
  });

  it('leaves out spaces, whose rooms an account does not join with them', () => {
    const getRooms = () => [
      room('!space:example.com', 'Team', { space: true }),
      room('!lobby:example.com', 'Lobby'),
    ];

    expect(invitableRooms({ getRooms, getDomain } as unknown as MatrixClient, new Set())).toEqual([
      { roomId: '!lobby:example.com', name: 'Lobby', address: '!lobby:example.com' },
    ]);
  });
});

describe('roomLabel', () => {
  it('adds the address only when another room has the same name', () => {
    const general = { roomId: '!a:example.com', name: 'General', address: '#general:example.com' };
    const twin = { roomId: '!b:example.com', name: 'General', address: '!b:example.com' };
    const lobby = { roomId: '!lobby:example.com', name: 'Lobby', address: '#lobby:example.com' };
    const offered = [general, twin, lobby];

    expect(roomLabel(general, offered)).toBe('General (\u2068#general:example.com\u2069)');
    expect(roomLabel(twin, offered)).toBe('General (\u2068!b:example.com\u2069)');
    expect(roomLabel(lobby, offered)).toBe('Lobby');
    // A room that is not on offer itself, such as one an upgrade replaced.
    expect(
      roomLabel({ roomId: '!old:example.com', name: 'Lobby', address: '!old:example.com' }, offered)
    ).toBe('Lobby (\u2068!old:example.com\u2069)');
  });
});
