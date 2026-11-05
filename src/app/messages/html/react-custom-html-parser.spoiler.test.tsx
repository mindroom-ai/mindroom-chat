import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';

vi.mock('../../rich-text/CustomHtml.css', () => ({
  Mention: () => 'Mention',
  Spoiler: ({ active }: { active?: boolean } = {}) => (active ? 'Spoiler revealed' : 'Spoiler'),
  Emoticon: () => 'Emoticon',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const renderHtml = (html: string) => {
  const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });
  act(() => {
    renderer = create(<>{parse(html, opts)}</>);
  });
  return renderer!;
};

const spoiler = () => renderer!.root.find((node) => node.props['data-mx-spoiler'] !== undefined);
const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

describe('message spoilers', () => {
  it('reveals on the first click without following a link or bubbling', () => {
    renderHtml('<span data-mx-spoiler><a href="https://secret.example">secret</a></span>');
    expect(spoiler().props['aria-pressed']).toBe(true);

    const click = clickEvent();
    act(() => {
      spoiler().props.onClick(click);
    });

    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();
    expect(spoiler().props['aria-pressed']).toBe(false);
    expect(spoiler().props.className).toBe('Spoiler revealed');
    // Once revealed, clicks reach the link again.
    expect(spoiler().props.onClick).toBeUndefined();
  });

  it('reveals with Enter or Space, and ignores other keys', () => {
    renderHtml('<span data-mx-spoiler="plot">twist</span>');
    expect(spoiler().props['aria-label']).toBe('plot');

    const tab = { key: 'Tab', ...clickEvent() };
    act(() => {
      spoiler().props.onKeyDown(tab);
    });
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(spoiler().props['aria-pressed']).toBe(true);

    const enter = { key: 'Enter', ...clickEvent() };
    act(() => {
      spoiler().props.onKeyDown(enter);
    });
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(enter.stopPropagation).toHaveBeenCalled();
    expect(spoiler().props['aria-pressed']).toBe(false);
  });

  it('names a spoiler without a reason', () => {
    renderHtml('<span data-mx-spoiler>twist</span>');
    expect(spoiler().props['aria-label']).toBe('Spoiler');
  });
});
