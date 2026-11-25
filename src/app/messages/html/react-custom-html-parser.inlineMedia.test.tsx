import parse from 'html-react-parser';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import {
  INLINE_MEDIA_CONTENT_KEY,
  InlineMediaContext,
  readInlineMedia,
} from '../../matrix/protocol/inlineMedia';
import { getLatestMessageContent } from '../../matrix/room';
import { ImageOverlay } from '../content/ImageOverlay';
import { RenderMessageContent } from '../content/RenderMessageContent';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';

const mocks = vi.hoisted(() => ({
  loadImageOriginal: vi.fn(),
  hydrateCachedLongText: vi.fn(),
}));
vi.mock('../content/imageOriginal', () => ({ loadImageOriginal: mocks.loadImageOriginal }));
vi.mock('../../event-store/cache/attachmentRepository', () => ({
  hydrateCachedLongText: mocks.hydrateCachedLongText,
}));
vi.mock('../../rich-text/CustomHtml.css', () => ({
  InlineImage: 'InlineImage',
  InlineImageButton: 'InlineImageButton',
  EmoticonBase: 'EmoticonBase',
  Emoticon: () => 'Emoticon',
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
vi.mock('../../rich-text/Footnote.css', () => ({}));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));
vi.mock('../content/ImageOverlay', () => ({ ImageOverlay: () => null }));

const plainHttpUrl = 'https://matrix.example/_matrix/client/v1/media/download/example/chart';
const mx = {
  mxcUrlToHttp: () => plainHttpUrl,
  getHomeserverUrl: () => 'https://matrix.example',
  getAccessToken: () => 'token',
  getUserId: () => '@reader:matrix.example',
} as unknown as MatrixClient;

const enc = (url: string, iv = 'iv-1', sha256 = 'h-1') => ({
  url,
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: `k-${iv}`, ext: true },
  iv,
  hashes: { sha256 },
  mimetype: 'image/png',
  size: 512,
});
const makeEvent = (id: string, ts: number, content: IContent) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!r:ex',
    event_id: id,
    sender: '@mindroom_helper:matrix.example',
    origin_server_ts: ts,
    content,
  });
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('encrypted inline message images', () => {
  let renderer: ReactTestRenderer | undefined;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.loadImageOriginal.mockReset();
    mocks.hydrateCachedLongText.mockReset();
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderMsg = (mEvent: MatrixEvent, content: IContent, hydrateLongText = false) => (
    <MatrixClientProvider value={mx}>
      <ClientConfigProvider value={{}}>
        <RenderMessageContent
          mEvent={mEvent}
          displayName="Helper"
          msgType="m.text"
          ts={mEvent.getTs()}
          getContent={(() => content) as never}
          urlPreview={false}
          hydrateLongText={hydrateLongText}
          htmlReactParserOptions={getReactCustomHtmlParser(mx, '!r:ex', {
            linkifyOpts: LINKIFY_OPTS,
          })}
          linkifyOpts={LINKIFY_OPTS}
        />
      </ClientConfigProvider>
    </MatrixClientProvider>
  );

  it('decrypts inline images, reuses the blob in ImageOverlay, handles decode error, and revokes on unmount', async () => {
    mocks.loadImageOriginal.mockResolvedValueOnce({ src: 'blob:decrypted-1' });
    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/chart': enc('mxc://ex/chart') },
    })!;
    const owner = {
      roomId: '!r:ex',
      eventId: '$e1',
      revisionTs: 10,
      revisionId: '',
      redacted: false,
    };
    const options = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });

    act(() => {
      renderer = create(
        <InlineMediaContext value={{ entries, owner }}>
          <div>{parse('<img src="mxc://ex/chart" alt="Revenue chart">', options)}</div>
        </InlineMediaContext>
      );
    });
    await flush();

    expect(mocks.loadImageOriginal).toHaveBeenCalledWith(
      mx,
      expect.objectContaining({ url: 'mxc://ex/chart', mimeType: 'image/png', owner })
    );
    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: 'blob:decrypted-1',
      alt: 'Revenue chart',
    });

    act(() => {
      renderer!.root
        .findByType('button')
        .props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    });
    expect(renderer!.root.findByType(ImageOverlay).props).toMatchObject({
      src: 'blob:decrypted-1',
      alt: 'Revenue chart',
    });

    act(() => {
      renderer!.root.findByType('img').props.onError({});
    });
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Revenue chart');

    act(() => renderer!.unmount());
    renderer = undefined;
    expect(revokeSpy).toHaveBeenCalledWith('blob:decrypted-1');
  });

  it('shows alt text with no plaintext fetch for mismatched url, bad entry, or failed hash', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mocks.loadImageOriginal.mockRejectedValueOnce(new Error('Hash mismatch'));
    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: {
        'mxc://ex/mismatch': enc('mxc://ex/other'),
        'mxc://ex/bad': { v: 'v1', url: 'mxc://ex/bad' },
        'mxc://ex/badhash': enc('mxc://ex/badhash'),
      },
    })!;
    const options = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });

    act(() => {
      renderer = create(
        <InlineMediaContext value={{ entries }}>
          <div>
            {parse(
              '<img src="mxc://ex/mismatch" alt="Mismatch"><img src="mxc://ex/bad" alt="Bad"><img src="mxc://ex/badhash" alt="BadHash">',
              options
            )}
          </div>
        </InlineMediaContext>
      );
    });
    await flush();

    expect(mocks.loadImageOriginal).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    const json = JSON.stringify(renderer!.toJSON());
    expect(json).toContain('Mismatch');
    expect(json).toContain('Bad');
    expect(json).toContain('BadHash');
  });

  it('keeps plain images unchanged without a map, respects mxcImages=false, and preserves linked images', async () => {
    const plainOpts = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });
    act(() => {
      renderer = create(<div>{parse('<img src="mxc://ex/plain" alt="Plain">', plainOpts)}</div>);
    });
    expect(mocks.loadImageOriginal).not.toHaveBeenCalled();
    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: plainHttpUrl,
      alt: 'Plain',
    });

    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/link': enc('mxc://ex/link') },
    })!;
    const blockedOpts = getReactCustomHtmlParser(mx, '!r:ex', {
      linkifyOpts: LINKIFY_OPTS,
      mxcImages: false,
    });
    act(() => {
      renderer!.update(
        <InlineMediaContext value={{ entries }}>
          <div>{parse('<img src="mxc://ex/link" alt="Blocked">', blockedOpts)}</div>
        </InlineMediaContext>
      );
    });
    await flush();
    expect(mocks.loadImageOriginal).not.toHaveBeenCalled();

    mocks.loadImageOriginal.mockResolvedValueOnce({ src: 'blob:linked-1' });
    act(() => {
      renderer!.update(
        <InlineMediaContext value={{ entries }}>
          <div>
            {parse(
              '<a href="https://example.org/doc"><img src="mxc://ex/link" alt="Linked"></a>',
              plainOpts
            )}
          </div>
        </InlineMediaContext>
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Linked');
    await flush();
    expect(renderer!.root.findByType('a').findByType('img').props.src).toBe('blob:linked-1');
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('uses edit revision and hydrated v2 long-text sidecar maps and revokes replaced blobs', async () => {
    mocks.loadImageOriginal
      .mockResolvedValueOnce({ src: 'blob:rev-1' })
      .mockResolvedValueOnce({ src: 'blob:rev-2' })
      .mockResolvedValueOnce({ src: 'blob:sidecar' });

    const root = makeEvent('$m1', 100, {
      msgtype: 'm.text',
      body: '![v1](mxc://ex/v1)',
      format: 'org.matrix.custom.html',
      formatted_body: '<p><img src="mxc://ex/v1" alt="v1"></p>',
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/v1': enc('mxc://ex/v1', 'iv-1', 'h-1') },
    });
    const edit = makeEvent('$e1', 200, {
      msgtype: 'm.text',
      body: '* ![v2](mxc://ex/v2)',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$m1' },
      'm.new_content': {
        msgtype: 'm.text',
        body: '![v2](mxc://ex/v2)',
        format: 'org.matrix.custom.html',
        formatted_body: '<p><img src="mxc://ex/v2" alt="v2"></p>',
        [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/v2': enc('mxc://ex/v2', 'iv-2', 'h-2') },
      },
    });

    act(() => {
      renderer = create(renderMsg(root, getLatestMessageContent(root, undefined)));
    });
    await flush();
    expect(renderer!.root.findByType('img').props.src).toBe('blob:rev-1');

    root.makeReplaced(edit);
    act(() => {
      renderer!.update(renderMsg(root, getLatestMessageContent(root, edit)));
    });
    await flush();
    expect(revokeSpy).toHaveBeenCalledWith('blob:rev-1');
    expect(renderer!.root.findByType('img').props.src).toBe('blob:rev-2');

    mocks.hydrateCachedLongText.mockResolvedValueOnce({
      msgtype: 'm.text',
      body: 'Full ![diagram](mxc://ex/sc)',
      format: 'org.matrix.custom.html',
      formatted_body: '<p><img src="mxc://ex/sc" alt="diagram"></p>',
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/sc': enc('mxc://ex/sc', 'iv-sc', 'h-sc') },
    });
    const preview: IContent = {
      msgtype: 'm.text',
      body: 'Preview...',
      file: enc('mxc://ex/sc-json', 'iv-json', 'h-json'),
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    act(() => {
      renderer!.update(renderMsg(makeEvent('$l1', 300, preview), preview, true));
    });
    await flush();
    await flush();
    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: 'blob:sidecar',
      alt: 'diagram',
    });
  });
});
