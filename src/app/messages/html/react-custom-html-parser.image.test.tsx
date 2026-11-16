import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageOverlay } from '../content/ImageOverlay';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';

vi.mock('../../rich-text/CustomHtml.css', () => ({
  InlineImage: 'InlineImage',
  InlineImageButton: 'InlineImageButton',
  EmoticonBase: 'EmoticonBase',
  Emoticon: () => 'Emoticon',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
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
});
