// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { useTurnBreakRowMeasurements } from './useThreadTurnFolds';
import { EMPTY_TURN_FOLD_VIEW, viewThreadTurnFolds, type ThreadTurnFold } from './threadTurnFolds';

// The row that draws a turn's break measured 600 px with its long reply; folded off screen, it
// must take its estimate again rather than keep that height.

const events = ['$q', '$a1', '$a2', '$a3'].map((id) => ({ getId: () => id } as MatrixEvent));
const fold: ThreadTurnFold = { key: '$q', hiddenIds: ['$a1', '$a2'], count: 2, answerId: '$a3' };
const estimate = (index: number) => (index === 1 ? 42 : 30);

const setup = (mountedKeys: string[]) => {
  const virtualizer = {
    elementsCache: new Map(mountedKeys.map((key) => [key, {}])),
    resizeItem: vi.fn(),
  } as unknown as Virtualizer<HTMLDivElement, Element>;
  function Probe({ open }: { open?: boolean }) {
    const view =
      open === undefined ? EMPTY_TURN_FOLD_VIEW : viewThreadTurnFolds([fold], () => open);
    useTurnBreakRowMeasurements(virtualizer, events, view, estimate);
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe />);
  });
  const render = (open?: boolean) => act(() => renderer.update(<Probe open={open} />));
  return { resizeItem: vi.mocked(virtualizer.resizeItem), render };
};

describe('useTurnBreakRowMeasurements', () => {
  it('gives an unmounted break row its estimate whenever its turn folds, opens or unfolds', () => {
    const { resizeItem, render } = setup([]);
    render(false);
    expect(resizeItem.mock.calls).toEqual([[1, 42]]);
    render(false);
    expect(resizeItem).toHaveBeenCalledTimes(1);
    render(true);
    expect(resizeItem.mock.calls.at(-1)).toEqual([1, 42]);
    render(undefined);
    expect(resizeItem).toHaveBeenCalledTimes(3);
  });

  it('leaves a mounted break row to measure itself', () => {
    const { resizeItem, render } = setup(['$a1']);
    render(false);
    render(true);
    expect(resizeItem).not.toHaveBeenCalled();
  });
});
