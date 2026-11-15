// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mockLayout,
  mockResizeObserver,
  restoreLayout,
  restoreResizeObserver,
} from './__tests__/layout';
import { SPOTLIGHT_GAP, TourSpotlight } from './TourSpotlight';
import type { TourPart } from './tourScenes';

function Stage({ part, composerBox = '8,300,400,48' }: { part?: TourPart; composerBox?: string }) {
  return (
    <div data-stage>
      <div data-box="20,60,500,200">
        <div data-box="12,12,476,80" data-tour-part="card:budget">
          <span data-box="13,9,300,20" data-tour-part="title:budget" />
        </div>
      </div>
      <div data-box={composerBox} data-tour-part="composer" />
      <div data-tour-part="back" />
      <TourSpotlight part={part} />
    </div>
  );
}

const ring = () => document.querySelector<HTMLElement>('[data-tour-spotlight]');
const placeOf = (element: HTMLElement | null) =>
  element && {
    transform: element.style.transform,
    width: element.style.width,
    height: element.style.height,
  };

beforeEach(() => mockLayout());

afterEach(() => {
  cleanup();
  restoreLayout();
  restoreResizeObserver();
});

describe('TourSpotlight', () => {
  it('rings the part a little outside it, by its layout offsets up to the stage', () => {
    render(<Stage part="title:budget" />);
    // 20 + 12 + 13 from the stage's edge and 60 + 12 + 9 from its top, less the gap.
    expect(placeOf(ring())).toEqual({
      transform: `translate(${45 - SPOTLIGHT_GAP}px, ${81 - SPOTLIGHT_GAP}px)`,
      width: `${300 + 2 * SPOTLIGHT_GAP}px`,
      height: `${20 + 2 * SPOTLIGHT_GAP}px`,
    });
  });

  it('follows the part from scene to scene', () => {
    const { rerender } = render(<Stage part="card:budget" />);
    expect(ring()?.style.transform).toBe(
      `translate(${32 - SPOTLIGHT_GAP}px, ${72 - SPOTLIGHT_GAP}px)`
    );
    const first = ring();

    rerender(<Stage part="composer" />);
    // The same ring, so it glides instead of appearing anew.
    expect(ring()).toBe(first);
    expect(ring()?.style.transform).toBe(
      `translate(${8 - SPOTLIGHT_GAP}px, ${300 - SPOTLIGHT_GAP}px)`
    );
  });

  it('shows no ring without a part, for a part that is not there, or one with no size', () => {
    const { rerender } = render(<Stage />);
    expect(ring()).toBeNull();
    rerender(<Stage part="bell" />);
    expect(ring()).toBeNull();
    rerender(<Stage part="back" />);
    expect(ring()).toBeNull();
    rerender(<Stage part="composer" />);
    expect(ring()).toBeTruthy();
    rerender(<Stage />);
    expect(ring()).toBeNull();
  });

  it('measures again when the part moved in a render', () => {
    const { rerender } = render(<Stage part="composer" />);
    rerender(<Stage part="composer" composerBox="8,340,400,48" />);
    expect(ring()?.style.transform).toBe(
      `translate(${8 - SPOTLIGHT_GAP}px, ${340 - SPOTLIGHT_GAP}px)`
    );
  });

  it('measures again when the stage is resized', () => {
    const observer = mockResizeObserver();
    render(<Stage part="composer" />);
    expect(observer.observed()).toBe(1);

    document.querySelector('[data-tour-part="composer"]')?.setAttribute('data-box', '8,200,300,48');
    act(() => observer.resize());

    expect(placeOf(ring())).toEqual({
      transform: `translate(${8 - SPOTLIGHT_GAP}px, ${200 - SPOTLIGHT_GAP}px)`,
      width: `${300 + 2 * SPOTLIGHT_GAP}px`,
      height: `${48 + 2 * SPOTLIGHT_GAP}px`,
    });
    cleanup();
    expect(observer.observed()).toBe(0);
  });

  it('shows no ring where the browser gives no layout', () => {
    restoreLayout();
    expect(() => render(<Stage part="composer" />)).not.toThrow();
    expect(ring()).toBeNull();
  });
});
