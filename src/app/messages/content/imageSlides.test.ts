import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { MEDIA_SPOILER_PROPERTY } from '../../matrix/send/msgContent';
import { buildImageSlides } from './imageSlides';

const ROOM = '!room:example.org';

type Content = Record<string, unknown>;

const event = (id: string, content: Content, extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1000,
    content,
    ...extra,
  });

const image = (name: string, info: Content = { mimetype: 'image/png' }): Content => ({
  msgtype: 'm.image',
  body: name,
  url: `mxc://example.org/${name}`,
  info,
});

type RelationsSet = Pick<EventTimelineSet, 'relations'>;
/** No timeline set: each event shows its own content. */
const noSet = (): RelationsSet | undefined => undefined;
const nothingHidden = () => false;
const nobodyIgnored: ReadonlySet<string> = new Set();

const ids = (
  events: MatrixEvent[],
  timelineSet = noSet,
  isHidden: (mEvent: MatrixEvent) => boolean = nothingHidden,
  ignoredUserIds = nobodyIgnored
) => buildImageSlides(events, timelineSet, isHidden, ignoredUserIds).map((slide) => slide.eventId);

describe('buildImageSlides', () => {
  it('turns a plain image into a slide with its name, file, type, info and owner', () => {
    const [slide] = buildImageSlides(
      [event('$a', image('a.png'))],
      noSet,
      nothingHidden,
      nobodyIgnored
    );

    expect(slide).toEqual({
      eventId: '$a',
      body: 'a.png',
      url: 'mxc://example.org/a.png',
      mimeType: 'image/png',
      info: { mimetype: 'image/png' },
      encInfo: undefined,
      owner: expect.objectContaining({ roomId: ROOM, eventId: '$a' }),
    });
  });

  it('reads an encrypted image from its file, with the file as its decryption info', () => {
    const file = {
      url: 'mxc://example.org/secret',
      key: { alg: 'A256CTR', ext: true, k: 'key', key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
    };
    const [slide] = buildImageSlides(
      [
        event('$e', {
          msgtype: 'm.image',
          body: 'secret.jpg',
          file,
          info: { mimetype: 'image/jpeg' },
        }),
      ],
      noSet,
      nothingHidden,
      nobodyIgnored
    );

    expect(slide?.url).toBe('mxc://example.org/secret');
    expect(slide?.encInfo).toEqual(file);
    expect(slide?.mimeType).toBe('image/jpeg');
  });

  it('keeps the timeline order', () => {
    const events = [
      event('$1', image('1.png')),
      event('$2', image('2.png')),
      event('$3', image('3.png')),
    ];
    expect(ids(events)).toEqual(['$1', '$2', '$3']);
  });

  it('leaves out text, stickers, and events not yet decrypted', () => {
    const events = [
      event('$text', { msgtype: 'm.text', body: 'hello' }),
      event(
        '$sticker',
        { body: 'wave', url: 'mxc://example.org/wave', info: {} },
        { type: 'm.sticker' }
      ),
      event(
        '$encrypted',
        { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
        { type: 'm.room.encrypted' }
      ),
      event('$image', image('i.png')),
    ];
    expect(ids(events)).toEqual(['$image']);
  });

  it('leaves out a redacted image', () => {
    const redacted = event('$gone', image('gone.png'), {
      unsigned: { redacted_because: { type: 'm.room.redaction', event_id: '$r' } },
    });
    expect(ids([redacted, event('$kept', image('kept.png'))])).toEqual(['$kept']);
  });

  it('leaves out an image marked as a spoiler', () => {
    const spoiler = event('$spoiler', { ...image('s.png'), [MEDIA_SPOILER_PROPERTY]: true });
    expect(ids([spoiler, event('$plain', image('p.png'))])).toEqual(['$plain']);
  });

  it('leaves out the rows a plugin hides', () => {
    const events = [event('$hidden', image('h.png')), event('$shown', image('s.png'))];
    expect(ids(events, noSet, (mEvent) => mEvent.getId() === '$hidden')).toEqual(['$shown']);
  });

  it('leaves out the images of a sender the reader ignores, as the timeline does', () => {
    const ignored = event('$ignored', image('i.png'), { sender: '@spam:example.org' });
    const events = [ignored, event('$kept', image('k.png'))];
    expect(ids(events, noSet, nothingHidden, new Set(['@spam:example.org']))).toEqual(['$kept']);
  });

  it('leaves out an image the timeline shows as a file row (SVG, not an image type, no file)', () => {
    const events = [
      event('$svg', image('vector.svg', { mimetype: 'image/svg+xml' })),
      event('$pdf', image('doc.pdf', { mimetype: 'application/pdf' })),
      event('$broken', { msgtype: 'm.image', body: 'nothing.png' }),
      event('$png', image('photo.png')),
    ];
    expect(ids(events)).toEqual(['$png']);
  });

  it('reads the newest edit from the timeline set the rows use, with that revision as owner', () => {
    const original = event('$edited', image('old.png'));
    const edit = event(
      '$edit',
      {
        ...image('* new.png'),
        'm.new_content': image('new.png'),
        'm.relates_to': { rel_type: 'm.replace', event_id: '$edited' },
      },
      { origin_server_ts: 2000 }
    );
    // The SDK has not applied the edit: only the set's relations know it, as in the room view.
    const roomSet = {
      relations: {
        getChildEventsForEvent: (eventId: string) =>
          eventId === '$edited' ? { getRelations: () => [edit] } : undefined,
      },
    } as unknown as RelationsSet;

    const [slide] = buildImageSlides([original], () => roomSet, nothingHidden, nobodyIgnored);
    expect(slide?.body).toBe('new.png');
    expect(slide?.url).toBe('mxc://example.org/new.png');
    expect(slide?.owner).toMatchObject({
      eventId: '$edited',
      revisionTs: 2000,
      revisionId: '$edit',
    });

    const [unedited] = buildImageSlides([original], noSet, nothingHidden, nobodyIgnored);
    expect(unedited?.body).toBe('old.png');
  });

  it("reads each event's edits from the set its row reads them from, a fork prefix's parent's", () => {
    const prefixed = event('$prefix', image('old.png'));
    const edit = event(
      '$edit',
      {
        ...image('* new.png'),
        'm.new_content': image('new.png'),
        'm.relates_to': { rel_type: 'm.replace', event_id: '$prefix' },
      },
      { origin_server_ts: 2000 }
    );
    const parentSet = {
      relations: {
        getChildEventsForEvent: (eventId: string) =>
          eventId === '$prefix' ? { getRelations: () => [edit] } : undefined,
      },
    } as unknown as RelationsSet;
    const forkSet = {
      relations: { getChildEventsForEvent: () => undefined },
    } as unknown as RelationsSet;

    const [slide] = buildImageSlides(
      [prefixed],
      (mEvent) => (mEvent.getId() === '$prefix' ? parentSet : forkSet),
      nothingHidden,
      nobodyIgnored
    );
    expect(slide?.body).toBe('new.png');
  });
});
