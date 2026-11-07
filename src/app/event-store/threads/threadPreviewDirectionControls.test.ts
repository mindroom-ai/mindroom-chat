import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../../test/utils/i18n';
import {
  getLocalizedThreadMessagePreviewText,
  getReplyPreviewText,
  getThreadMessagePreviewText,
  localizeThreadPreview,
} from './threadMessagePreview';
import { getThreadPrimarySummaryText } from './threadPresentation';

// Previews show a message's text on one line: in reply quotes, the composer's reply bar, thread
// cards and notifications. A bidirectional control in that text (U+202A to U+202E, U+2066 to
// U+2069, U+200E, U+200F, U+061C) shows as its code point there, as in the message itself, so
// `invoice<U+202E>txt.exe` cannot read as `invoiceexe.txt`. The isolates the app puts around a
// user ID after a name, and those of a translation, still work; the text kept for the thread's
// records, and the summary an edit starts from, stay as they are.

const t = translateFromEn as unknown as TFunction;

const PLAIN = 'Rename the report to invoice‮txt.exe‬ before Friday.';
const PLAIN_SHOWN = 'Rename the report to invoice<U+202E>txt.exe<U+202C> before Friday.';
const FILE_NAME = 'quarterly-report‮fdp.exe';
const FILE_NAME_SHOWN = 'quarterly-report<U+202E>fdp.exe';

/** A thread without a summary whose root reads "Root". */
const ROOT = {
  summaryText: undefined,
  rootPreviewText: 'Root',
  rootPreviewLocalization: undefined,
};

const ME = '@me:example.org';
const ROOM_ID = '!desk:example.org';
const AVERY = '@avery:example.org';

/** A room whose member Avery's display name ends in a right-to-left mark. */
const roomWithAvery = (): Room => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  const room = new Room(ROOM_ID, mx, ME);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      state_key: AVERY,
      sender: AVERY,
      room_id: ROOM_ID,
      event_id: '$avery',
      content: { membership: 'join', displayname: 'Avery Quinn‏' },
    }),
  ]);
  return room;
};

describe('preview text for the screen', () => {
  it('shows each direction control of a message as its code point', () => {
    expect(getLocalizedThreadMessagePreviewText({ msgtype: 'm.text', body: PLAIN }, t)).toBe(
      PLAIN_SHOWN
    );
    expect(
      getLocalizedThreadMessagePreviewText({ msgtype: 'm.text', body: 'a⁦b⁧c⁨d⁩e‪f‫g‭h‎i‏j؜k' }, t)
    ).toBe(
      'a<U+2066>b<U+2067>c<U+2068>d<U+2069>e<U+202A>f<U+202B>g<U+202D>h<U+200E>i<U+200F>j<U+061C>k'
    );
  });

  it("shows a file's name with its controls as code points", () => {
    expect(
      getLocalizedThreadMessagePreviewText(
        { msgtype: 'm.file', body: FILE_NAME, url: 'mxc://example.org/file' },
        t
      )
    ).toBe(FILE_NAME_SHOWN);
  });

  it("reveals the controls of an agent's prose beside its tool count, not the translation's isolates", () => {
    // Arabic writes the count between a first-strong isolate and its end.
    const isolatingT = ((key: string, options?: { count?: number }) =>
      key === 'sharedUi.threadPreviews.tools'
        ? `⁨${options?.count ?? 0}⁩ tools`
        : key) as unknown as TFunction;
    const content = {
      msgtype: 'm.text',
      body: '🔧 `shell` [1]\n\nMoved invoice‮txt.exe‬ to the archive.',
    };
    expect(getLocalizedThreadMessagePreviewText(content, isolatingT)).toBe(
      '🔧 ⁨1⁩ tools · Moved invoice<U+202E>txt.exe<U+202C> to the archive.'
    );
  });

  it("keeps the isolated user ID after a mentioned member's name in a reply quote", () => {
    const room = roomWithAvery();
    expect(getReplyPreviewText(room, { msgtype: 'm.text', body: `${AVERY} ${PLAIN}` }, t)).toBe(
      `@Avery Quinn (⁦${AVERY}⁩) ${PLAIN_SHOWN}`
    );
  });

  it("shows a thread summary's and a root's controls as code points", () => {
    expect(getThreadPrimarySummaryText({ ...ROOT, summaryText: PLAIN }, t)).toBe(PLAIN_SHOWN);
    expect(getThreadPrimarySummaryText({ ...ROOT, rootPreviewText: FILE_NAME }, t)).toBe(
      FILE_NAME_SHOWN
    );
  });

  it('leaves the text kept for records and edits as it is', () => {
    expect(getThreadMessagePreviewText({ msgtype: 'm.text', body: PLAIN })).toBe(PLAIN);
    expect(localizeThreadPreview(PLAIN, undefined)).toBe(PLAIN);
    // The summary an edit of it starts from.
    expect(getThreadPrimarySummaryText({ ...ROOT, summaryText: PLAIN })).toBe(PLAIN);
    expect(getThreadPrimarySummaryText({ ...ROOT, rootPreviewText: FILE_NAME })).toBe(FILE_NAME);
  });
});
