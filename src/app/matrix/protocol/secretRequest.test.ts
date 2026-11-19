import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  effectiveSecretRequestStatus,
  parseSecretRequestContent,
  secretRequestPath,
  type SecretRequest,
} from './secretRequest';

const inner = (overrides: Record<string, unknown> = {}) => ({
  request_id: 'req-1',
  requester_id: '@person:example.org',
  service: 'openrouter',
  display_name: 'OpenRouter',
  hosts: ['openrouter.ai'],
  reason: 'To call models',
  status: 'pending',
  expires_at: 1_000,
  ...overrides,
});

const temporary = (overrides: Record<string, unknown> = {}) => ({
  request_id: 'req-1',
  requester_id: '@person:example.org',
  env: 'SUDO_PASSWORD',
  reason: 'To restart the web server',
  status: 'pending',
  expires_at: 1_000,
  keep: { memory: 900, disk: 86_400 },
  ...overrides,
});

const content = (value: unknown) => ({
  msgtype: 'm.notice',
  body: 'Key needed',
  [MINDROOM_SECRET_REQUEST_KEY]: value,
});

describe('parseSecretRequestContent', () => {
  it('parses the backend contract object', () => {
    expect(parseSecretRequestContent(content(inner()))).toEqual({
      kind: 'key',
      requestId: 'req-1',
      requesterId: '@person:example.org',
      service: 'openrouter',
      displayName: 'OpenRouter',
      hosts: ['openrouter.ai'],
      replaces: false,
      reason: 'To call models',
      status: 'pending',
      expiresAt: 1_000,
    });
  });

  it('reads replaces only when it is true', () => {
    const replaces = (value: unknown) => {
      const request = parseSecretRequestContent(content(inner({ replaces: value })));
      return request?.kind === 'key' ? request.replaces : undefined;
    };
    expect(replaces(true)).toBe(true);
    expect(replaces(false)).toBe(false);
    expect(replaces('true')).toBe(false);
    expect(replaces(1)).toBe(false);
  });

  it('parses a temporary secret, which has a variable and keeps in place of a service', () => {
    expect(parseSecretRequestContent(content(temporary()))).toEqual({
      kind: 'temporary',
      requestId: 'req-1',
      requesterId: '@person:example.org',
      env: 'SUDO_PASSWORD',
      keep: { memory: 900, disk: 86_400 },
      kept: null,
      reason: 'To restart the web server',
      status: 'pending',
      expiresAt: 1_000,
    });
  });

  it('reads the new service a key card proposes', () => {
    const newService = {
      name: 'openrouter',
      display_name: 'OpenRouter',
      rules: [
        { host: 'openrouter.ai', path_prefix: '/api/', auth: { type: 'bearer' } },
        {
          host: 'git.example.test',
          path_prefix: '/',
          port: 8443,
          auth: { type: 'header', name: 'X-Key' },
        },
        { host: 'dav.example.test', path_prefix: '/', auth: { type: 'basic', username: 'bot' } },
      ],
      placeholder_env: { OPENROUTER_API_KEY: 'mindroom-brokered' },
    };
    const request = parseSecretRequestContent(content(inner({ new_service: newService })));

    expect(request).toMatchObject({
      kind: 'key',
      newService: {
        name: 'openrouter',
        displayName: 'OpenRouter',
        rules: [
          { host: 'openrouter.ai', pathPrefix: '/api/', auth: { type: 'bearer' } },
          {
            host: 'git.example.test',
            pathPrefix: '/',
            port: 8443,
            auth: { type: 'header', name: 'X-Key' },
          },
          { host: 'dav.example.test', pathPrefix: '/', auth: { type: 'basic', username: 'bot' } },
        ],
        env: ['OPENROUTER_API_KEY'],
      },
    });
    expect(parseSecretRequestContent(content(inner()))).not.toHaveProperty('newService');
  });

  it('marks a new service it cannot read as null, so the card offers no Save', () => {
    const rule = { host: 'openrouter.ai', path_prefix: '/', auth: { type: 'bearer' } };
    const valid = {
      name: 'openrouter',
      display_name: 'OpenRouter',
      rules: [rule],
      placeholder_env: {},
    };
    const newService = (value: unknown) => {
      const request = parseSecretRequestContent(content(inner({ new_service: value })));
      return request?.kind === 'key' ? request.newService : 'not a key card';
    };
    expect(newService(valid)).not.toBeNull();
    [
      'openrouter',
      null,
      { ...valid, name: 'other' },
      { ...valid, display_name: 7 },
      { ...valid, rules: [] },
      { ...valid, rules: 'openrouter.ai' },
      { ...valid, rules: [{ ...rule, host: 7 }] },
      { ...valid, rules: [{ ...rule, path_prefix: undefined }] },
      { ...valid, rules: [{ ...rule, port: 0 }] },
      { ...valid, rules: [{ ...rule, port: '8443' }] },
      { ...valid, rules: [{ ...rule, auth: undefined }] },
      { ...valid, rules: [{ ...rule, auth: { type: 'oauth' } }] },
      { ...valid, rules: [{ ...rule, auth: { type: 'header' } }] },
      { ...valid, rules: [{ ...rule, auth: { type: 'basic' } }] },
      { ...valid, placeholder_env: { 'NOT-A-NAME': 'x' } },
      { ...valid, placeholder_env: undefined },
    ].forEach((value) => expect(newService(value)).toBeNull());
  });

  it('reads the keep an answered temporary secret has', () => {
    const kept = (value: unknown) => {
      const request = parseSecretRequestContent(
        content(temporary({ status: 'saved', kept: value }))
      );
      return request?.kind === 'temporary' ? request.kept : undefined;
    };
    expect(kept('disk')).toBe('disk');
    expect(kept('memory')).toBe('memory');
    expect(kept('forever')).toBeNull();
    expect(kept(undefined)).toBeNull();
  });

  it('keeps only the keeps it knows, with a lifetime in seconds', () => {
    const keep = (value: unknown) => {
      const request = parseSecretRequestContent(content(temporary({ keep: value })));
      return request?.kind === 'temporary' ? request.keep : request;
    };
    expect(keep({ memory: 60 })).toEqual({ memory: 60 });
    expect(keep({ memory: 60, forever: 1, disk: '86400' })).toEqual({ memory: 60 });
    expect(keep({ memory: 0, disk: 86_400 })).toEqual({ disk: 86_400 });
    expect(keep({})).toBeNull();
    expect(keep({ memory: -1 })).toBeNull();
    expect(keep(['memory'])).toBeNull();
    expect(keep(undefined)).toBeNull();
  });

  it('rejects a temporary secret whose variable no shell takes, or that also names a service', () => {
    ['', '1PASSWORD', 'SUDO-PASSWORD', 'SUDO PASSWORD', 'A=B', 'A'.repeat(65), 7].forEach((env) =>
      expect(parseSecretRequestContent(content(temporary({ env })))).toBeNull()
    );
    expect(parseSecretRequestContent(content(temporary({ env: 'A'.repeat(64) })))).not.toBeNull();
    expect(parseSecretRequestContent(content(temporary({ service: 'openrouter' })))).toBeNull();
    expect(parseSecretRequestContent(content(temporary({ hosts: [] })))).toBeNull();
    expect(parseSecretRequestContent(content(temporary({ display_name: 'X' })))).toBeNull();
  });

  it('reads what the agent chose to show: a label, the page that gives the secret and a field hint', () => {
    const request = parseSecretRequestContent(
      content(
        temporary({
          label: ' GitHub\n token ',
          url: 'https://github.com/settings/tokens?type=beta',
          placeholder: ' ghp_… ',
        })
      )
    );

    expect(request).toMatchObject({
      kind: 'temporary',
      label: 'GitHub token',
      url: 'https://github.com/settings/tokens?type=beta',
      placeholder: 'ghp_…',
    });
  });

  it('gives a key card the link and the hint, and no label: its service names it', () => {
    const request = parseSecretRequestContent(
      content(inner({ label: 'GitHub', url: 'http://localhost:8080/keys', placeholder: 'sk-…' }))
    );

    expect(request).toMatchObject({
      kind: 'key',
      url: 'http://localhost:8080/keys',
      placeholder: 'sk-…',
    });
    expect(request).not.toHaveProperty('label');
  });

  it('shows a card without its link when the link is no http or https page', () => {
    [
      'javascript:alert(1)',
      'ftp://example.org/token',
      'github.com/settings/tokens',
      'https://ada:secret@github.com/',
      'https://ada@github.com/',
      'https://github.com:99999/',
      `https://github.com/${'a'.repeat(2000)}`,
      '',
      7,
      null,
    ].forEach((url) => {
      const request = parseSecretRequestContent(content(temporary({ url })));
      expect(request?.kind).toBe('temporary');
      expect(request).not.toHaveProperty('url');
    });
  });

  it('cuts a label and a hint to one short line, and drops an empty or mistyped one', () => {
    const cut = parseSecretRequestContent(
      content(temporary({ label: 'L'.repeat(200), placeholder: 'P'.repeat(200) }))
    );
    expect(cut).toMatchObject({ label: 'L'.repeat(80), placeholder: 'P'.repeat(80) });

    const dropped = parseSecretRequestContent(
      content(temporary({ label: ' \n ', placeholder: 7 }))
    );
    expect(dropped?.kind).toBe('temporary');
    expect(dropped).not.toHaveProperty('label');
    expect(dropped).not.toHaveProperty('placeholder');
  });

  it('prefers m.new_content', () => {
    const edited = {
      ...content(inner()),
      'm.new_content': content(inner({ status: 'saved' })),
    };
    expect(parseSecretRequestContent(edited)?.status).toBe('saved');
  });

  it('rejects an unknown status', () => {
    expect(parseSecretRequestContent(content(inner({ status: 'done' })))).toBeNull();
  });

  it('rejects non-array or non-string hosts', () => {
    expect(parseSecretRequestContent(content(inner({ hosts: 'openrouter.ai' })))).toBeNull();
    expect(parseSecretRequestContent(content(inner({ hosts: [1] })))).toBeNull();
  });

  it('rejects missing or mistyped fields and non-objects', () => {
    expect(parseSecretRequestContent(content(inner({ expires_at: '1000' })))).toBeNull();
    expect(parseSecretRequestContent(content(inner({ request_id: undefined })))).toBeNull();
    expect(parseSecretRequestContent({ body: 'x' })).toBeNull();
    expect(parseSecretRequestContent(null)).toBeNull();
    expect(parseSecretRequestContent('text')).toBeNull();
  });

  it('takes a URL-safe request ID of 1 to 128 characters', () => {
    const id = (requestId: string) =>
      parseSecretRequestContent(content(inner({ request_id: requestId })))?.requestId;
    expect(id('Ab9_-x')).toBe('Ab9_-x');
    expect(id('a'.repeat(128))).toBe('a'.repeat(128));
  });

  // A dot-only ID would make `.../secret-requests/..` another path once the URL is normalized.
  it.each(['', '.', '..', 'a.b', 'a/b', 'a b', '%2e', 'a'.repeat(129)])(
    'rejects the request ID %j',
    (requestId) => {
      expect(parseSecretRequestContent(content(inner({ request_id: requestId })))).toBeNull();
    }
  );
});

describe('effectiveSecretRequestStatus', () => {
  const request = (status: SecretRequest['status']): SecretRequest => ({
    kind: 'key',
    requestId: 'r',
    requesterId: '@p:e',
    service: 's',
    displayName: 'S',
    hosts: [],
    replaces: false,
    reason: '',
    status,
    expiresAt: 1_000,
  });

  it('turns pending into expired at and past expiresAt', () => {
    expect(effectiveSecretRequestStatus(request('pending'), 999)).toBe('pending');
    expect(effectiveSecretRequestStatus(request('pending'), 1_000)).toBe('expired');
    expect(effectiveSecretRequestStatus(request('pending'), 2_000)).toBe('expired');
  });

  it('keeps final statuses', () => {
    expect(effectiveSecretRequestStatus(request('saved'), 2_000)).toBe('saved');
    expect(effectiveSecretRequestStatus(request('declined'), 2_000)).toBe('declined');
  });
});

describe('the reply and tool call that asked', () => {
  it('reads them from either kind of card and from an edit', () => {
    const fields = { response_event_id: '$reply', tool_call_id: 'call_1' };
    const anchor = { responseEventId: '$reply', toolCallId: 'call_1' };
    expect(parseSecretRequestContent(content(inner(fields)))?.anchor).toEqual(anchor);
    expect(parseSecretRequestContent(content(temporary(fields)))?.anchor).toEqual(anchor);
    expect(
      parseSecretRequestContent({
        body: '* Key needed',
        'm.new_content': content(temporary({ ...fields, status: 'saved', kept: 'memory' })),
      })?.anchor
    ).toEqual(anchor);
  });

  it('reads neither when one is missing or not an ID, and the card still parses', () => {
    [
      {},
      { response_event_id: '$reply' },
      { tool_call_id: 'call_1' },
      { response_event_id: '', tool_call_id: 'call_1' },
      { response_event_id: '$reply', tool_call_id: 7 },
      { response_event_id: '$reply', tool_call_id: 'x'.repeat(513) },
    ].forEach((fields) => {
      const parsed = parseSecretRequestContent(content(temporary(fields)));
      expect(parsed?.kind).toBe('temporary');
      expect(parsed).not.toHaveProperty('anchor');
    });
  });
});

describe('secretRequestPath', () => {
  it('encodes room and request IDs', () => {
    expect(secretRequestPath('!room:server', 'a/b')).toBe(
      '/api/rooms/!room%3Aserver/secret-requests/a%2Fb'
    );
  });
});
