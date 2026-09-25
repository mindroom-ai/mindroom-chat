import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  excelDesktopUrl,
  httpsUrl,
  isRedactedCell,
  parseDocumentCard,
  parseDocumentEditArguments,
  readDocumentCard,
} from './documentProtocol';

const viewerId = '@alice:example.org';
const agentId = '@mindroom_analyst:example.org';
const roomId = '!room:example.org';

const cardData = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  event: 'connected',
  document_id: 'b!drive:01ITEM',
  name: 'Forecast.xlsx',
  kind: 'xlsx',
  web_url: 'https://contoso.sharepoint.com/sites/finance/_layouts/15/Doc.aspx?sourcedoc=%7BA1%7D',
  file_url: 'https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Forecast.xlsx',
  location: 'FY27',
  revision: { etag: '"{E},1"', modified_at: '2026-09-25T10:05:40Z', modified_by: 'Sam Kim' },
  requester_id: viewerId,
  agent_user_id: agentId,
  room_id: roomId,
  thread_id: '$thread',
  ...overrides,
});

const change = {
  summary: 'Raise growth to 12%',
  status: 'applied',
  verified: true,
  cells_changed: 1,
  edits: [{ range: 'Assumptions!B4', outcome: 'applied', cells_changed: 1, verified: true }],
};

const makeEvent = (data: Record<string, unknown>, event: Record<string, unknown> = {}) =>
  new MatrixEvent({
    event_id: '$card',
    room_id: roomId,
    sender: agentId,
    type: 'm.room.message',
    origin_server_ts: 100_000,
    content: { msgtype: 'm.notice', body: 'Connected Forecast.xlsx', 'io.mindroom.document': data },
    ...event,
  });

const makeRoom = (members: string[] = [viewerId, agentId, '@mindroom_foreign:elsewhere.org']) => {
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: viewerId });
  const room = new Room(roomId, mx, viewerId);
  members.forEach((userId) =>
    room.currentState.setStateEvents([
      new MatrixEvent({
        event_id: `$member-${userId}`,
        room_id: roomId,
        sender: userId,
        type: 'm.room.member',
        state_key: userId,
        content: { membership: 'join' },
      }),
    ])
  );
  return room;
};

describe('document card parsing', () => {
  it('parses connected cards and edited cards with their change', () => {
    expect(parseDocumentCard(cardData())).toEqual({
      event: 'connected',
      documentId: 'b!drive:01ITEM',
      name: 'Forecast.xlsx',
      kind: 'xlsx',
      webUrl:
        'https://contoso.sharepoint.com/sites/finance/_layouts/15/Doc.aspx?sourcedoc=%7BA1%7D',
      fileUrl: 'https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Forecast.xlsx',
      location: 'FY27',
      modifiedAt: '2026-09-25T10:05:40Z',
      modifiedBy: 'Sam Kim',
      change: undefined,
    });
    expect(parseDocumentCard(cardData({ event: 'edited', change }))?.change).toEqual({
      summary: 'Raise growth to 12%',
      status: 'applied',
      verified: true,
      cellsChanged: 1,
      edits: [
        {
          range: 'Assumptions!B4',
          outcome: 'applied',
          cellsChanged: 1,
          verified: true,
          alreadyApplied: false,
        },
      ],
    });
  });

  it.each([
    ['unknown version', { version: 2 }],
    ['unknown kind', { kind: 'docx' }],
    ['unknown event', { event: 'deleted' }],
    ['missing name', { name: '' }],
    ['edited without change', { event: 'edited' }],
    ['change on a connected card', { change }],
    ['malformed change', { event: 'edited', change: { ...change, edits: [{ range: 'A1' }] } }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseDocumentCard(cardData(overrides))).toBeUndefined();
  });

  it('drops links that are not plain HTTPS', () => {
    const card = parseDocumentCard(
      cardData({
        web_url: ['javascript', 'alert(1)'].join(':'),
        file_url: 'https://user:pw@evil.example/x.xlsx',
      })
    );
    expect(card?.webUrl).toBeUndefined();
    expect(card?.fileUrl).toBeUndefined();
    expect(httpsUrl('http://contoso.sharepoint.com/x')).toBeUndefined();
    expect(httpsUrl('ms-excel:ofe|u|https://x')).toBeUndefined();
    expect(excelDesktopUrl(undefined)).toBeUndefined();
    expect(excelDesktopUrl('https://contoso.sharepoint.com/a.xlsx')).toBe(
      'ms-excel:ofe|u|https://contoso.sharepoint.com/a.xlsx'
    );
  });
});

describe('document card authority', () => {
  it('reads a card from a joined same-server agent notice', () => {
    expect(readDocumentCard(makeEvent(cardData()), viewerId, makeRoom())?.name).toBe(
      'Forecast.xlsx'
    );
  });

  it.each([
    ['a human sender', {}, { sender: viewerId }],
    [
      'a foreign-server agent',
      { agent_user_id: '@mindroom_foreign:elsewhere.org' },
      { sender: '@mindroom_foreign:elsewhere.org' },
    ],
    ['a mismatched agent identity', { agent_user_id: '@mindroom_other:example.org' }, {}],
    ['another room', { room_id: '!other:example.org' }, {}],
    ['a non-notice message', {}, { content: { msgtype: 'm.text', body: 'x' } }],
  ])('ignores %s', (_label, data, event) => {
    expect(
      readDocumentCard(makeEvent(cardData(data), event), viewerId, makeRoom())
    ).toBeUndefined();
  });

  it('ignores agents that are not joined', () => {
    expect(readDocumentCard(makeEvent(cardData()), viewerId, makeRoom([viewerId]))).toBeUndefined();
  });
});

describe('document edit arguments', () => {
  const args = {
    document_id: 'b!drive:01ITEM',
    summary: 'Raise growth',
    edits: [
      {
        range: 'Assumptions!B4:B5',
        before: [[0.08], [142]],
        after: [[0.12], [142]],
        number_format: [['0%'], ['0']],
      },
    ],
    skip_conflicts: true,
  };

  it('parses complete arguments', () => {
    expect(parseDocumentEditArguments(args)).toEqual({
      documentId: 'b!drive:01ITEM',
      summary: 'Raise growth',
      skipConflicts: true,
      edits: [
        {
          range: 'Assumptions!B4:B5',
          before: [[0.08], [142]],
          after: [[0.12], [142]],
          numberFormat: [['0%'], ['0']],
        },
      ],
    });
  });

  it('keeps null formats and ignores an edit-level null format', () => {
    const withNulls = parseDocumentEditArguments({
      edits: [
        {
          range: 'A!A1:A2',
          before: [[1], [2]],
          after: [[3], [2]],
          number_format: [['0%'], [null]],
        },
        { range: 'A!B1', before: [[1]], after: [[2]], number_format: null },
      ],
    });
    expect(withNulls?.edits.map((edit) => edit.numberFormat)).toEqual([
      [['0%'], [null]],
      undefined,
    ]);
  });

  it.each([
    ['no edits', { ...args, edits: [] }],
    ['mismatched shapes', { ...args, edits: [{ range: 'A!A1', before: [[1]], after: [[1, 2]] }] }],
    [
      'ragged grids',
      { ...args, edits: [{ range: 'A!A1', before: [[1], [1, 2]], after: [[1], [1, 2]] }] },
    ],
    ['nested cells', { ...args, edits: [{ range: 'A!A1', before: [[{}]], after: [[1]] }] }],
    [
      'non-string formats',
      { ...args, edits: [{ range: 'A!A1', before: [[1]], after: [[1]], number_format: [[1]] }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(parseDocumentEditArguments(value)).toBeUndefined();
  });

  it('marks redacted cells', () => {
    expect(isRedactedCell('***redacted***')).toBe(true);
    expect(isRedactedCell('=IF(secret=***redacted***,2,3)')).toBe(true);
    expect(isRedactedCell('plain')).toBe(false);
  });
});
