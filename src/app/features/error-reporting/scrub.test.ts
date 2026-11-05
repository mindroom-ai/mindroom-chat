import { describe, expect, it } from 'vitest';
import { type ReportEvent, scrubEvent, scrubText, scrubUrl } from './scrub';

// Everything a report must never carry, as it would appear in a real account.
const FORBIDDEN = [
  // Message bodies.
  'Hello Bob, the launch code is 4242',
  'launch code',
  'Meet me at the station at 5pm',
  'station',
  'Draft of the quarterly letter',
  'quarterly',
  // Room names.
  'Project Falcon',
  'Falcon',
  // Display names.
  'Alice Liddell',
  'Liddell',
  'Bob Builder',
  // Matrix IDs, plain and URL-encoded.
  '@alice:example.org',
  'alice:example.org',
  '@helper_agent:example.org',
  '!AbCdEfGhIjKl:example.org',
  'AbCdEfGhIjKl',
  'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde',
  '#falcon:example.org',
  '$Ev3ntIdAbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  'Ev3ntIdAbCd',
  '%21AbCdEfGhIjKl',
  '%40alice',
  // Access tokens and other secrets.
  'syt_YWxpY2U_TrZnmBhLfdWQiOyGzeXb_0vRfXq',
  'TrZnmBhLfdWQiOyGzeXb',
  'k7Qp2XvB9mN4sR8tW1yZ3aC6dE0fG5hJ',
  'eyJhbGciOiJIUzI1NiJ9',
  'hunter2-password',
  'sessioncookie123',
  // URLs with tokens.
  'access_token=',
  'loginToken',
  'sentry_key=leaked',
  // File names.
  'holiday-photo.jpg',
  'holiday photo',
  'Q3 budget.xlsx',
  'budget',
  'tax-return-2026.pdf',
  'tax-return',
  'scan.pdf',
  'voice-note.ogg',
  // Email addresses and the client's address.
  'alice@example.org',
  '203.0.113.7',
] as const;

const EVENT_ID = '0123456789abcdef0123456789abcdef';

/** A report as it might look after a hostile mix of errors, breadcrumbs and stray fields. */
const leakyEvent = (): ReportEvent => {
  const event = {
    event_id: EVENT_ID,
    timestamp: 1_793_861_019.5,
    platform: 'javascript',
    level: 'error',
    logger: 'mindroom-client',
    release: 'ef6ac4d',
    environment: 'chat.example.org',
    sdk: { name: 'mindroom-client.reporter', version: '1' },
    message: 'Could not mention “Alice Liddell” in "Project Falcon" for @alice:example.org',
    exception: {
      values: [
        {
          type: 'SyntaxError',
          value:
            'Unexpected token \'H\', "Hello Bob, the launch code is 4242"... is not valid JSON',
          mechanism: { type: 'onunhandledrejection', handled: false },
          stacktrace: {
            frames: [
              {
                filename:
                  'https://chat.example.org/assets/index-B9x8Z2Ab.js?access_token=syt_YWxpY2U_TrZnmBhLfdWQiOyGzeXb_0vRfXq#k7Qp2XvB9mN4sR8tW1yZ3aC6dE0fG5hJ',
                abs_path: 'https://chat.example.org/home/%21AbCdEfGhIjKl%3Aexample.org/',
                function: 'sendMessage',
                lineno: 12,
                colno: 3456,
                in_app: true,
              },
              {
                filename: 'https://chat.example.org/assets/MindroomRoomTimeline-CQ1bG0aB.js',
                function: 'Hello Bob, the launch code is 4242',
                lineno: 3,
                colno: 77,
                in_app: true,
              },
            ],
          },
        },
        {
          type: 'MatrixError',
          value:
            'MatrixError: [403] User @alice:example.org not in room !AbCdEfGhIjKl:example.org (https://matrix.example.org/_matrix/client/v3/rooms/%21AbCdEfGhIjKl%3Aexample.org/send/m.room.message/m1793861019.3?access_token=syt_YWxpY2U_TrZnmBhLfdWQiOyGzeXb_0vRfXq)',
        },
        {
          type: 'Error',
          value:
            'Could not load image https://matrix.example.org/_matrix/client/v1/media/download/example.org/AbCdEfGhIjKlMnOpQrStUvWx/holiday%20photo.jpg?allow_redirect=true and room #falcon:example.org',
        },
        {
          type: 'Error',
          value: 'Invalid MindRoom paste file name: Q3 budget.xlsx',
        },
        {
          type: 'Error',
          value:
            'Upload of tax-return-2026.pdf and voice-note.ogg failed for alice@example.org; Authorization: Bearer k7Qp2XvB9mN4sR8tW1yZ3aC6dE0fG5hJ',
        },
        {
          type: 'TypeError',
          value:
            "Failed to open ‘Project Falcon’ in thread $Ev3ntIdAbCdEfGhIjKlMnOpQrStUvWxYz0123456789 of !AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJl, password=hunter2-password and 'Draft of the quarterly letter'",
        },
      ],
    },
    tags: {
      route: '/home/!AbCdEfGhIjKl:example.org/$Ev3ntIdAbCdEfGhIjKlMnOpQrStUvWxYz0123456789/',
      errcode: 'M_FORBIDDEN',
      http_status: '403',
      room_name: 'Project Falcon',
      user: '@alice:example.org',
    },
    contexts: {
      viewport: { width: 1280, height: 720, device_pixel_ratio: 2, owner: 'Alice Liddell' },
      room: { name: 'Project Falcon', id: '!AbCdEfGhIjKl:example.org' },
    },
    extra: {
      body: 'Meet me at the station at 5pm',
      formatted_body: '<p>Meet me at the station at 5pm</p>',
      content: { body: 'Draft of the quarterly letter', msgtype: 'm.text' },
      displayName: 'Bob Builder',
      room_name: 'Project Falcon',
      roomId: '!AbCdEfGhIjKl:example.org',
      file_name: 'scan.pdf',
      accessToken: 'syt_YWxpY2U_TrZnmBhLfdWQiOyGzeXb_0vRfXq',
      note: 'sent by Alice Liddell <alice@example.org> from https://chat.example.org/?loginToken=abc',
      duration_ms: 3456,
      nested: { level2: { level3: { level4: { level5: 'Hello Bob, the launch code is 4242' } } } },
    },
    request: {
      url: 'https://chat.example.org/home/%21AbCdEfGhIjKl%3Aexample.org/?threadId=%24Ev3ntIdAbCd&sentry_key=leaked',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        Authorization: 'Bearer k7Qp2XvB9mN4sR8tW1yZ3aC6dE0fG5hJ',
        Cookie: 'session=sessioncookie123',
      },
      cookies: 'session=sessioncookie123',
      query_string: 'access_token=syt_YWxpY2U_TrZnmBhLfdWQiOyGzeXb_0vRfXq',
      data: { body: 'Hello Bob, the launch code is 4242' },
    },
    user: {
      id: '@alice:example.org',
      username: 'Alice Liddell',
      email: 'alice@example.org',
      ip_address: '203.0.113.7',
    },
    server_name: 'Alice Liddell’s laptop',
    fingerprint: ['send-failure', '!AbCdEfGhIjKl:example.org', 'Project Falcon'],
    breadcrumbs: {
      values: [
        {
          timestamp: 1_793_861_000,
          category: 'navigation',
          message: 'Opened “Project Falcon” with @alice:example.org',
          data: {
            from: '/home/:roomIdOrAlias/',
            to: '/direct/%40alice%3Aexample.org/',
            initial: true,
            duration_ms: 3456,
            displayname: 'Alice Liddell',
          },
        },
        {
          timestamp: 1_793_861_010,
          category: 'console',
          message: 'Uploading tax-return-2026.pdf for Bob Builder: "Meet me at the station at 5pm"',
          data: { body: 'Hello Bob, the launch code is 4242', file: 'holiday-photo.jpg' },
        },
      ],
    },
  };
  return event as unknown as ReportEvent;
};

describe('scrubEvent', () => {
  const scrubbed = scrubEvent(leakyEvent());
  const json = JSON.stringify(scrubbed);

  it.each(FORBIDDEN)('removes %s', (forbidden) => {
    expect(json).not.toContain(forbidden);
  });

  it('keeps no field outside the report format', () => {
    expect(scrubbed).not.toBeNull();
    expect(Object.keys(scrubbed ?? {})).not.toContain('user');
    expect(Object.keys(scrubbed ?? {})).not.toContain('server_name');
    expect(scrubbed?.request?.headers).toEqual({
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    });
    expect(scrubbed?.request).not.toHaveProperty('cookies');
    expect(scrubbed?.request).not.toHaveProperty('query_string');
    expect(scrubbed?.request).not.toHaveProperty('data');
    expect(scrubbed?.tags).toEqual({
      route: '/home/<room-id>/<event-id>/',
      errcode: 'M_FORBIDDEN',
      http_status: '403',
    });
    expect(scrubbed?.contexts).toEqual({
      viewport: { width: 1280, height: 720, device_pixel_ratio: 2 },
    });
    expect(scrubbed?.extra).toEqual({ duration_ms: 3456 });
    expect(scrubbed?.fingerprint).toEqual(['send-failure', '<room-id>', '<text>']);
    expect(scrubbed?.breadcrumbs?.values[1]).toEqual({
      timestamp: 1_793_861_010,
      category: 'console',
      level: 'info',
      data: {},
    });
  });

  it('keeps what the report is for', () => {
    const [syntax, matrix, image] = scrubbed?.exception?.values ?? [];
    expect(syntax?.type).toBe('SyntaxError');
    expect(syntax?.value).toBe('Unexpected token \'H\', "<text>"... is not valid JSON');
    expect(syntax?.mechanism).toEqual({ type: 'onunhandledrejection', handled: false });
    expect(syntax?.stacktrace?.frames[0]).toEqual({
      filename: 'https://chat.example.org/assets/index-B9x8Z2Ab.js',
      abs_path: 'https://chat.example.org/home/<room-id>/',
      function: 'sendMessage',
      lineno: 12,
      colno: 3456,
      in_app: true,
    });
    expect(syntax?.stacktrace?.frames[1]?.filename).toBe(
      'https://chat.example.org/assets/MindroomRoomTimeline-CQ1bG0aB.js'
    );
    expect(syntax?.stacktrace?.frames[1]?.function).toBe('?');
    expect(matrix?.value).toBe(
      'MatrixError: [403] User <user-id> not in room <room-id> (https://matrix.example.org/_matrix/client/v3/rooms/<room-id>/send/m.room.message/m1793861019.3)'
    );
    expect(image?.value).toBe(
      'Could not load image https://matrix.example.org/_matrix/client/v1/media/download/<media> and room <room-alias>'
    );
    expect(scrubbed?.release).toBe('ef6ac4d');
    expect(scrubbed?.request?.url).toBe('https://chat.example.org/home/<room-id>/');
    expect(scrubbed?.breadcrumbs?.values[0]?.data).toEqual({
      from: '/home/:roomIdOrAlias/',
      to: '/direct/<user-id>/',
      initial: true,
      duration_ms: 3456,
    });
  });

  it('keeps a release that is a full commit hash, and drops one that is not a version', () => {
    const release = '65bd73646449d6fb0e768885adcb4b314e924a15';
    const report = scrubEvent({
      ...leakyEvent(),
      release,
      contexts: { app: { app_version: 'v0.1.0', app_build: release } },
    });
    expect(report?.release).toBe(release);
    expect(report?.contexts?.app).toEqual({ app_version: 'v0.1.0', app_build: release });
    expect(scrubEvent({ ...leakyEvent(), release: 'built by @alice:example.org' })?.release).toBe(
      undefined
    );
  });

  it('refuses a report without a valid event id', () => {
    expect(scrubEvent({ ...leakyEvent(), event_id: '@alice:example.org' })).toBeNull();
  });
});

describe('scrubText', () => {
  it('leaves engine messages about code readable', () => {
    expect(scrubText("Cannot read properties of undefined (reading 'getId')")).toBe(
      "Cannot read properties of undefined (reading 'getId')"
    );
    expect(
      scrubText("Failed to execute 'querySelector' on 'Document': '#!x y' is not a valid selector.")
    ).toBe("Failed to execute 'querySelector' on 'Document': '<text>' is not a valid selector.");
    expect(scrubText("Can't send the event: the room is not encrypted")).toBe(
      "Can't send the event: the room is not encrypted"
    );
    expect(
      scrubText(
        'Failed to fetch dynamically imported module: https://chat.example.org/assets/MindroomClientNonUIFeatures-B9x8Z2Ab.js'
      )
    ).toBe(
      'Failed to fetch dynamically imported module: https://chat.example.org/assets/MindroomClientNonUIFeatures-B9x8Z2Ab.js'
    );
    expect(
      scrubText('Minified React error #185; visit https://react.dev/errors/185?args[]=x')
    ).toBe('Minified React error #185; visit https://react.dev/errors/185');
  });

  it('removes Tuwunel tokens, room version 12 room IDs and emails', () => {
    expect(scrubText('token k7Qp2XvB9mN4sR8tW1yZ3aC6dE0fG5hJ rejected')).toBe(
      'token <token> rejected'
    );
    expect(scrubText('no room !AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde')).toBe(
      'no room <room-id>'
    );
    expect(scrubText('invite alice@example.org')).toBe('invite <email>');
  });

  it('bounds the length', () => {
    expect(scrubText('x'.repeat(5000), 50)).toHaveLength(50);
  });
});

describe('scrubUrl', () => {
  it('drops the query, fragment, credentials and the content of data and blob URLs', () => {
    expect(scrubUrl('https://user:secret@example.org/a/b?access_token=x#y')).toBe(
      'https://example.org/a/b'
    );
    expect(scrubUrl('mxc://example.org/AbCdEfGhIjKl')).toBe('mxc://<media>');
    expect(scrubUrl('data:text/plain;base64,SGVsbG8=')).toBe('data:<url>');
    expect(scrubUrl('blob:https://chat.example.org/1234')).toBe('blob:<url>');
  });
});
