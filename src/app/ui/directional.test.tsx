// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PopOut,
  TooltipProvider,
  documentIsRightToLeft,
  mirrorPlacement,
  textDirection,
} from './directional';

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

describe('textDirection', () => {
  it('reads the direction of the first letter, past marks, digits and emoji', () => {
    expect(textDirection('@Mind draft the launch email.')).toBe('ltr');
    expect(textDirection('🔧 `web_search` [1]\n\nIt is from the report.')).toBe('ltr');
    expect(textDirection('12 مرحبا hello')).toBe('rtl');
    expect(textDirection('«שלום» world')).toBe('rtl');
    expect(textDirection('Привет')).toBe('ltr');
    expect(textDirection('日本語')).toBe('ltr');
  });

  it('has no direction for a text without letters', () => {
    expect(textDirection('')).toBeUndefined();
    expect(textDirection('👍 123 !?')).toBeUndefined();
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

describe('TooltipProvider on a touch screen', () => {
  const pointer = (type: string, pointerType: string, movement = 0) => {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      movementX: { value: movement },
    });
    document.body.dispatchEvent(event);
  };

  it('opens no tooltip from a hover that a tap set off, until a mouse moves', () => {
    act(() => {
      create(<TooltipProvider tooltip={<span />}>{(ref) => <span ref={ref} />}</TooltipProvider>);
    });
    // folds hands its children a ref object and listens on the trigger after the ref is set.
    const foldsRef: { current: Element | null } = { current: null };
    type Trigger = { ref: (node: Element | null) => void };
    const { children } = received.tooltip[0] as { children: (ref: unknown) => Trigger };
    const trigger = document.createElement('button');
    children(foldsRef).ref(trigger);
    expect(foldsRef.current).toBe(trigger);
    const opened = vi.fn();
    trigger.addEventListener('mouseenter', opened);

    pointer('pointerdown', 'touch');
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    expect(opened).not.toHaveBeenCalled();

    pointer('pointermove', 'mouse', 3);
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
