// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectableTextNear } from './dom';

// jsdom lays nothing out and has no Range.getClientRects, so each text node gets one line box
// here: 100 by 20 px at (50, 40).
const layOutLines = () => {
  Range.prototype.getClientRects = vi.fn(
    () => [new DOMRect(50, 40, 100, 20)] as unknown as DOMRectList
  );
};

afterEach(() => {
  delete (Range.prototype as Partial<Range>).getClientRects;
  document.body.replaceChildren();
});

const paragraph = (html: string) => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
};

describe('selectableTextNear', () => {
  it('finds text under the point and within the reach of its glyphs', () => {
    layOutLines();
    const target = paragraph('<p>Release notes</p>');
    expect(selectableTextNear(target, 60, 50, 10)).toBe(true);
    // Between lines, or just past the line's end.
    expect(selectableTextNear(target, 155, 65, 10)).toBe(true);
  });

  it('finds the text of formatted markup under the touched element', () => {
    layOutLines();
    // A finger between two formatted words, or on the strip above bold glyphs, touches the block.
    expect(
      selectableTextNear(paragraph('<p><strong>Hello</strong> <em>world</em></p>'), 60, 50, 10)
    ).toBe(true);
    expect(selectableTextNear(paragraph('<li>Run <code>npm ci</code></li>'), 60, 50, 10)).toBe(
      true
    );
  });

  it('finds none in the empty space beside the text', () => {
    layOutLines();
    const target = paragraph('<p>Release notes</p>');
    expect(selectableTextNear(target, 170, 50, 10)).toBe(false);
    expect(selectableTextNear(target, 60, 75, 10)).toBe(false);
  });

  it('ignores blank text, button labels, hidden spoilers and text styled unselectable', () => {
    layOutLines();
    expect(selectableTextNear(paragraph('<div>  <img alt=""> </div>'), 60, 50, 10)).toBe(false);
    expect(
      selectableTextNear(
        paragraph('<button><span>Reply</span></button>').firstElementChild!,
        60,
        50,
        10
      )
    ).toBe(false);
    expect(
      selectableTextNear(paragraph('<p style="user-select: none">Badge</p>'), 60, 50, 10)
    ).toBe(false);
    // A hidden spoiler is a button until revealed; selecting it would show its text.
    expect(
      selectableTextNear(paragraph('<p><span role="button">secret</span></p>'), 60, 50, 10)
    ).toBe(false);
    expect(
      selectableTextNear(
        paragraph('<div><p><span>Name</span></p><button>Reply</button></div>'),
        60,
        50,
        10
      )
    ).toBe(true);
  });
});
