import parse from 'html-react-parser';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { INLINE_MEDIA_CONTENT_KEY, readInlineMedia } from '../../matrix/protocol/inlineMedia';
import { getLatestMessageContent } from '../../matrix/room';
import { ImageOverlay } from '../content/ImageOverlay';
import { InlineMediaContext } from '../content/inlineMediaContext';
import { RenderMessageContent } from '../content/RenderMessageContent';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';

const mocks = vi.hoisted(() => ({
  loadImageOriginal: vi.fn(),
  hydrateCachedLongText: vi.fn(),
}));

vi.mock('../content/imageOriginal', () => ({
  loadImageOriginal: mocks.loadImageOriginal,
}));
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

const encEntry = (url: string, iv = 'iv-1', sha256 = 'hash-1') => ({
  url,
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: `k-${iv}`, ext: true },
  iv,
  hashes: { sha256 },
  mimetype: 'image/png',
  size: 512,
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

  it('decrypts inline images via loadImageOriginal, reuses the blob in ImageOverlay, and revokes on unmount', async () => {
    mocks.loadImageOriginal.mockResolvedValueOnce({ src: 'blob:decrypted-1' });
    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/chart': encEntry('mxc://ex/chart') },
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
      expect.objectContaining({
        url: 'mxc://ex/chart',
        mimeType: 'image/png',
        owner,
        encInfo: expect.objectContaining({ url: 'mxc://ex/chart', iv: 'iv-1' }),
      })
    );
    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: 'blob:decrypted-1',
      alt: 'Revenue chart',
      className: 'InlineImage',
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

    // If the decrypted blob cannot decode (e.g. SVG served as application/octet-stream), fall back to alt text.
    act(() => {
      renderer!.root.findByType('img').props.onError({});
    });
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(renderer!.root.findAllByType(ImageOverlay)).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Revenue chart');

    act(() => renderer!.unmount());
    renderer = undefined;
    expect(revokeSpy).toHaveBeenCalledWith('blob:decrypted-1');
  });

  it('renders alt text with zero fetches for mismatched url, malformed entry, or failed hash', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mocks.loadImageOriginal.mockRejectedValueOnce(new Error('Hash mismatch'));

    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: {
        'mxc://ex/mismatch': encEntry('mxc://ex/different'),
        'mxc://ex/bad': { v: 'v1', url: 'mxc://ex/bad' },
        'mxc://ex/badhash': encEntry('mxc://ex/badhash'),
      },
    })!;
    const options = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });

    act(() => {
      renderer = create(
        <InlineMediaContext value={{ entries }}>
          <div>
            {parse(
              '<img src="mxc://ex/mismatch" alt="Mismatch">' +
                '<img src="mxc://ex/bad" alt="Malformed">' +
                '<img src="mxc://ex/badhash" alt="BadHash">',
              options
            )}
          </div>
        </InlineMediaContext>
      );
    });
    await flush();

    expect(mocks.loadImageOriginal).toHaveBeenCalledTimes(1);
    expect(mocks.loadImageOriginal).toHaveBeenCalledWith(
      mx,
      expect.objectContaining({ url: 'mxc://ex/badhash' })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
    const json = JSON.stringify(renderer!.toJSON());
    expect(json).toContain('Mismatch');
    expect(json).toContain('Malformed');
    expect(json).toContain('BadHash');
  });

  it('leaves behavior unchanged without an inline_media map, honors mxcImages=false, and preserves linked images', async () => {
    const plainOptions = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });
    act(() => {
      renderer = create(<div>{parse('<img src="mxc://ex/plain" alt="Plain">', plainOptions)}</div>);
    });
    expect(mocks.loadImageOriginal).not.toHaveBeenCalled();
    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: plainHttpUrl,
      alt: 'Plain',
    });

    const entries = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/link': encEntry('mxc://ex/link') },
    })!;
    const blockedOptions = getReactCustomHtmlParser(mx, '!r:ex', {
      linkifyOpts: LINKIFY_OPTS,
      mxcImages: false,
    });
    act(() => {
      renderer!.update(
        <InlineMediaContext value={{ entries }}>
          <div>{parse('<img src="mxc://ex/link" alt="Blocked">', blockedOptions)}</div>
        </InlineMediaContext>
      );
    });
    await flush();
    expect(mocks.loadImageOriginal).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain('Blocked');

    mocks.loadImageOriginal.mockResolvedValueOnce({ src: 'blob:linked-1' });
    act(() => {
      renderer!.update(
        <InlineMediaContext value={{ entries }}>
          <div>
            {parse(
              '<a href="https://example.org/doc"><img src="mxc://ex/link" alt="Linked"></a>',
              plainOptions
            )}
          </div>
        </InlineMediaContext>
      );
    });
    // Keeps accessible link text while decrypting, then renders img directly inside <a> (no button).
    expect(JSON.stringify(renderer!.toJSON())).toContain('Linked');
    await flush();
    const link = renderer!.root.findByType('a');
    expect(link.props.href).toBe('https://example.org/doc');
    expect(link.findByType('img').props).toMatchObject({ src: 'blob:linked-1', alt: 'Linked' });
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('uses the edit revision inline_media map through RenderMessageContent and revokes replaced blobs', async () => {
    mocks.loadImageOriginal
      .mockResolvedValueOnce({ src: 'blob:rev-1' })
      .mockResolvedValueOnce({ src: 'blob:rev-2' });

    const rootEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!r:ex',
      event_id: '$msg1',
      sender: '@mindroom_helper:matrix.example',
      origin_server_ts: 100,
      content: {
        msgtype: 'm.text',
        body: '![v1](mxc://ex/v1)',
        format: 'org.matrix.custom.html',
        formatted_body: '<p><img src="mxc://ex/v1" alt="v1"></p>',
        [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/v1': encEntry('mxc://ex/v1', 'iv-1', 'h-1') },
      },
    });
    const editEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!r:ex',
      event_id: '$edit1',
      sender: '@mindroom_helper:matrix.example',
      origin_server_ts: 200,
      content: {
        msgtype: 'm.text',
        body: '* ![v2](mxc://ex/v2)',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$msg1' },
        'm.new_content': {
          msgtype: 'm.text',
          body: '![v2](mxc://ex/v2)',
          format: 'org.matrix.custom.html',
          formatted_body: '<p><img src="mxc://ex/v2" alt="v2"></p>',
          [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/v2': encEntry('mxc://ex/v2', 'iv-2', 'h-2') },
        },
      },
    });

    const parserOptions = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });
    const renderMsg = (content: IContent) => (
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider value={{}}>
          <RenderMessageContent
            mEvent={rootEvent}
            displayName="Helper"
            msgType="m.text"
            ts={100}
            getContent={(() => content) as never}
            urlPreview={false}
            htmlReactParserOptions={parserOptions}
            linkifyOpts={LINKIFY_OPTS}
          />
        </ClientConfigProvider>
      </MatrixClientProvider>
    );

    act(() => {
      renderer = create(renderMsg(getLatestMessageContent(rootEvent, undefined)));
    });
    await flush();
    expect(renderer!.root.findByType('img').props).toMatchObject({ src: 'blob:rev-1', alt: 'v1' });

    rootEvent.makeReplaced(editEvent);
    act(() => {
      renderer!.update(renderMsg(getLatestMessageContent(rootEvent, editEvent)));
    });
    await flush();

    expect(revokeSpy).toHaveBeenCalledWith('blob:rev-1');
    expect(renderer!.root.findByType('img').props).toMatchObject({ src: 'blob:rev-2', alt: 'v2' });
    expect(mocks.loadImageOriginal).toHaveBeenLastCalledWith(
      mx,
      expect.objectContaining({
        url: 'mxc://ex/v2',
        encInfo: expect.objectContaining({ iv: 'iv-2', hashes: { sha256: 'h-2' } }),
      })
    );
  });

  it('uses io.mindroom.inline_media from hydrated v2 long-text sidecar content', async () => {
    const sidecarEntry = encEntry('mxc://ex/sidecar-img', 'iv-sc', 'h-sc');
    mocks.hydrateCachedLongText.mockResolvedValueOnce({
      msgtype: 'm.text',
      body: 'Full ![diagram](mxc://ex/sidecar-img)',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Full <img src="mxc://ex/sidecar-img" alt="diagram"></p>',
      [INLINE_MEDIA_CONTENT_KEY]: { 'mxc://ex/sidecar-img': sidecarEntry },
    });
    mocks.loadImageOriginal.mockResolvedValueOnce({ src: 'blob:sidecar-img' });

    const previewContent: IContent = {
      msgtype: 'm.text',
      body: 'Preview...',
      file: encEntry('mxc://ex/sidecar-json', 'iv-json', 'h-json'),
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!r:ex',
      event_id: '$long1',
      sender: '@mindroom_helper:matrix.example',
      origin_server_ts: 300,
      content: previewContent,
    });
    const parserOptions = getReactCustomHtmlParser(mx, '!r:ex', { linkifyOpts: LINKIFY_OPTS });

    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              displayName="Helper"
              msgType="m.text"
              ts={300}
              getContent={(() => previewContent) as never}
              urlPreview={false}
              hydrateLongText
              htmlReactParserOptions={parserOptions}
              linkifyOpts={LINKIFY_OPTS}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      );
    });
    await flush();
    await flush();

    expect(renderer!.root.findByType('img').props).toMatchObject({
      src: 'blob:sidecar-img',
      alt: 'diagram',
    });
    expect(mocks.loadImageOriginal).toHaveBeenCalledWith(
      mx,
      expect.objectContaining({
        url: 'mxc://ex/sidecar-img',
        encInfo: expect.objectContaining({ iv: 'iv-sc', hashes: { sha256: 'h-sc' } }),
      })
    );
  });
});
