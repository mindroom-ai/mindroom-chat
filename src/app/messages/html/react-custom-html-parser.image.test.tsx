import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFetchedAvatars } from '../../avatars/avatarMedia';
import { ImageOverlay } from '../content/ImageOverlay';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';

vi.mock('../../rich-text/CustomHtml.css', () => ({
  InlineImage: 'InlineImage',
  InlineImageButton: 'InlineImageButton',
  EmoticonBase: 'EmoticonBase',
  Emoticon: () => 'Emoticon',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
vi.mock('../../rich-text/Footnote.css', () => ({}));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));
// The parser owns opening and closing; the existing overlay owns the modal and viewer.
vi.mock('../content/ImageOverlay', () => ({ ImageOverlay: () => null }));

let renderer: ReactTestRenderer | undefined;
const url = 'https://matrix.example/_matrix/client/v1/media/download/example/chart';
const mx = {
  mxcUrlToHttp: () => url,
  getHomeserverUrl: () => 'https://matrix.example',
  getAccessToken: () => 'cap-token',
  getUserId: () => '@me:matrix.example',
} as unknown as MatrixClient;
const renderHtml = (html: string) => {
  const options = getReactCustomHtmlParser(mx, undefined, { linkifyOpts: LINKIFY_OPTS });
  act(() => {
    renderer = create(<div>{parse(html, options)}</div>);
  });
  return renderer!.root;
};
const event = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  void clearFetchedAvatars();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('inline message images', () => {
  it('styles an mxc image, preserves its dimensions, and opens the existing viewer on click', () => {
    const root = renderHtml(
      '<img src="mxc://example/chart" alt="chart" width="1600" height="1200">'
    );
    const image = root.findByType('img');
    expect(image.props).toMatchObject({
      className: 'InlineImage',
      src: url,
      alt: 'chart',
      width: '1600',
      height: '1200',
      loading: 'lazy',
    });
    expect(root.findAllByType(ImageOverlay)).toHaveLength(0);
    const button = root.findByType('button');
    expect(button.props).toMatchObject({ type: 'button', 'aria-label': 'chart' });
    const click = event();
    act(() => {
      button.props.onClick(click);
    });
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();
    const overlay = root.findByType(ImageOverlay);
    expect(overlay.props).toMatchObject({ src: url, alt: 'chart' });
    act(() => {
      overlay.props.requestClose();
    });
    expect(root.findAllByType(ImageOverlay)).toHaveLength(0);
  });

  it.each([
    '<img src="mxc://example/chart" alt="Report">',
    '<strong><img src="mxc://example/chart" alt="Report"></strong>',
  ])('preserves link navigation for a linked image: %s', (content) => {
    const root = renderHtml(`<a href="https://example.org/report">${content}</a>`);
    const link = root.findByType('a');
    expect(link.props.href).toBe('https://example.org/report');
    expect(link.findByType('img').props).toMatchObject({
      className: 'InlineImage',
      src: url,
      alt: 'Report',
      loading: 'lazy',
    });
    expect(root.findAllByType('button')).toHaveLength(0);
    expect(root.findAllByType(ImageOverlay)).toHaveLength(0);
  });

  it('names an image without alt text', () => {
    const root = renderHtml('<img src="mxc://example/chart">');
    expect(root.findByType('button').props['aria-label']).toBe('View');
  });

  it('keeps emoticons small and non-interactive', () => {
    const root = renderHtml('<img src="mxc://example/chart" data-mx-emoticon alt=":chart:">');
    const image = root.findByType('img');
    expect(image.props).toMatchObject({ className: 'Emoticon', alt: ':chart:', src: url });
    expect(root.findAllByType('button')).toHaveLength(0);
    expect(image.props.onClick).toBeUndefined();
    expect(image.props.tabIndex).toBeUndefined();
    expect(root.findAllByType(ImageOverlay)).toHaveLength(0);
  });

  it('does not turn external images into interactive media', () => {
    const root = renderHtml('<img src="https://example.org/chart.png" alt="chart">');
    expect(root.findAllByType('img')).toHaveLength(0);
    expect(root.findAllByType(ImageOverlay)).toHaveLength(0);
    expect(root.findByType('div').children).toEqual(['chart']);
  });

  it('fetches inline images with Bearer auth on Capacitor and re-fetches for ImageOverlay after cache eviction', async () => {
    vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
    vi.stubGlobal('navigator', {});
    let blobs = 0;
    const fetchMock = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobs += 1;
      return `blob:inline-${blobs}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const options = getReactCustomHtmlParser(mx, undefined, {
      linkifyOpts: LINKIFY_OPTS,
      useAuthentication: true,
    });
    act(() => {
      renderer = create(<div>{parse('<img src="mxc://example/chart" alt="chart">', options)}</div>);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(fetchMock).toHaveBeenCalledWith(url, {
      headers: { Authorization: 'Bearer cap-token' },
      cache: 'no-store',
    });
    expect(renderer!.root.findByType('img').props.src).toBe('blob:inline-1');

    // Evict the cached blob URL before opening the overlay; clicking must fetch a fresh live URL.
    await clearFetchedAvatars();
    act(() => {
      renderer!.root.findByType('button').props.onClick(event());
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType(ImageOverlay).props).toMatchObject({
      src: 'blob:inline-2',
      alt: 'chart',
    });
  });

  it('keeps accessible link text for a linked image and falls back to alt text for failed emoticons on Capacitor', async () => {
    vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
    vi.stubGlobal('navigator', {});
    let finishFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unused');

    const options = getReactCustomHtmlParser(mx, undefined, {
      linkifyOpts: LINKIFY_OPTS,
      useAuthentication: true,
    });
    act(() => {
      renderer = create(
        <div>
          {parse(
            '<a href="https://example.org/report"><img src="mxc://example/chart" alt="Report"></a>' +
              '<img src="mxc://example/chart" data-mx-emoticon alt=":parrot:">',
            options
          )}
        </div>
      );
    });

    // While fetching, the anchor stays labelled by its alt text and the emoticon does not flash text.
    const link = renderer!.root.findByType('a');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Report');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(':parrot:');
    expect(link.findAllByType('img')).toHaveLength(0);

    // After a failed Bearer fetch, both keep their fallback text.
    finishFetch(new Response('', { status: 404 }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(link.findAllByType('img')).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Report');
    expect(JSON.stringify(renderer!.toJSON())).toContain(':parrot:');
  });
});
