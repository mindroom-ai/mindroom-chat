// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadRootTitle } from './ThreadRootTitle';

afterEach(() => {
  vi.restoreAllMocks();
});

// A title its line cuts at a word, then shown whole on a phone at the same width (a layout switch
// that leaves the banner as wide as it was): the phone shows every word.
it('shows the whole title once whole, though its line had cut it at the same width', () => {
  const text = 'Notes from the upload review of the second floor';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (candidate: string) => ({ width: candidate.length * 10 }),
  } as unknown as CanvasRenderingContext2D);
  const createNodeMock = () => {
    const span = document.createElement('span');
    Object.defineProperty(span, 'scrollWidth', { value: text.length * 10 });
    Object.defineProperty(span, 'clientWidth', { value: 200 });
    return span;
  };
  const shown = (renderer: ReturnType<typeof create>) =>
    renderer.root
      .findByProps({ 'data-thread-context-root-title': 'true' })
      .findAll((node) => typeof node.children[0] === 'string')
      .map((node) => node.children.join(''))
      .at(-1);

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<ThreadRootTitle text={text} />, { createNodeMock });
  });
  expect(shown(renderer)).toBe('Notes from the…');

  act(() => renderer.update(<ThreadRootTitle text={text} whole />));
  expect(shown(renderer)).toBe(text);
});
