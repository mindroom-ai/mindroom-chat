// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopOut, TooltipProvider, documentIsRightToLeft, mirrorPlacement } from '.';

const received = vi.hoisted(() => ({ popOut: [] as unknown[], tooltip: [] as unknown[] }));

vi.mock('folds', () => ({
  PopOut: (props: Record<string, unknown>) => {
    received.popOut.push(props);
    return null;
  },
  TooltipProvider: (props: Record<string, unknown>) => {
    received.tooltip.push(props);
    return null;
  },
}));

afterEach(() => {
  document.documentElement.removeAttribute('dir');
  received.popOut.length = 0;
  received.tooltip.length = 0;
});

describe('mirrorPlacement', () => {
  it('keeps every placement in a left-to-right document', () => {
    expect(mirrorPlacement({ position: 'Right', align: 'End' }, false)).toEqual({
      position: 'Right',
      align: 'End',
    });
    expect(mirrorPlacement({ position: 'Bottom', align: 'Start' }, false)).toEqual({
      position: 'Bottom',
      align: 'Start',
    });
  });

  it('opens on the other side beside the anchor and keeps the top or bottom alignment', () => {
    expect(mirrorPlacement({ position: 'Right', align: 'Start' }, true)).toEqual({
      position: 'Left',
      align: 'Start',
    });
    expect(mirrorPlacement({ position: 'Left', align: 'End' }, true)).toEqual({
      position: 'Right',
      align: 'End',
    });
  });

  it('lines up with the other end above or below the anchor', () => {
    expect(mirrorPlacement({ position: 'Bottom', align: 'End' }, true)).toEqual({
      position: 'Bottom',
      align: 'Start',
    });
    expect(mirrorPlacement({ position: 'Top', align: 'Start' }, true)).toEqual({
      position: 'Top',
      align: 'End',
    });
    expect(mirrorPlacement({ position: 'Top', align: 'Center' }, true)).toEqual({
      position: 'Top',
      align: 'Center',
    });
  });

  it("treats a missing position as folds' default, above or below", () => {
    expect(mirrorPlacement({ align: 'End' }, true)).toEqual({
      position: undefined,
      align: 'Start',
    });
    expect(mirrorPlacement({}, true)).toEqual({ position: undefined, align: undefined });
  });
});

describe('documentIsRightToLeft', () => {
  it('follows the dir attribute that the language sets on the document', () => {
    expect(documentIsRightToLeft()).toBe(false);
    document.documentElement.setAttribute('dir', 'rtl');
    expect(documentIsRightToLeft()).toBe(true);
    document.documentElement.setAttribute('dir', 'ltr');
    expect(documentIsRightToLeft()).toBe(false);
  });
});

describe('PopOut and TooltipProvider', () => {
  const renderBoth = () => {
    act(() => {
      create(
        <>
          <PopOut position="Bottom" align="End" content={<span />} offset={4}>
            <span />
          </PopOut>
          <TooltipProvider position="Right" align="Start" tooltip={<span />}>
            {() => <span />}
          </TooltipProvider>
        </>
      );
    });
  };

  it('hands folds the placement as given in a left-to-right document', () => {
    renderBoth();
    expect(received.popOut[0]).toMatchObject({ position: 'Bottom', align: 'End', offset: 4 });
    expect(received.tooltip[0]).toMatchObject({ position: 'Right', align: 'Start' });
  });

  it('hands folds the mirrored placement in a right-to-left document', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    renderBoth();
    expect(received.popOut[0]).toMatchObject({ position: 'Bottom', align: 'Start', offset: 4 });
    expect(received.tooltip[0]).toMatchObject({ position: 'Left', align: 'Start' });
  });
});
