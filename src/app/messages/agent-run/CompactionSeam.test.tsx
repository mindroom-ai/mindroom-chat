// @vitest-environment jsdom
/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { fireEvent, render as renderDom, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplyCompaction } from '../../matrix/protocol/compactions';
import { timeHourMinuteSecond } from '../../lib/time';
import { CompactionNoticeSeam, CompactionSeam } from './CompactionSeam';

vi.mock('folds', () => ({
  PopOut: ({ anchor, content, position, align, offset, ...props }: any) =>
    anchor
      ? React.createElement(
          'div',
          { ...props, 'data-popout': true, 'data-position': position, 'data-top': anchor.y },
          content
        )
      : null,
}));

vi.mock('@tabler/icons-react', () => ({
  IconFold: ({ size }: any) =>
    React.createElement('svg', { 'data-icon': 'fold', 'data-size': size }),
  IconAlertTriangle: ({ size }: any) =>
    React.createElement('svg', { 'data-icon': 'alert', 'data-size': size }),
}));

vi.mock('../../preferences/useHour24Clock', () => ({
  useHour24Clock: () => [false, () => undefined],
}));

vi.mock('./CompactionSeam.css', () => ({
  Seam: 'Seam',
  Trigger: 'Trigger',
  Icon: 'Icon',
  Separator: 'Separator',
  Rule: 'Rule',
  Card: 'Card',
  Head: 'Head',
  Tag: 'Tag',
  Subtitle: 'Subtitle',
  Gauge: 'Gauge',
  GaugeWas: 'GaugeWas',
  GaugeNow: 'GaugeNow',
  GaugeLabel: 'GaugeLabel',
  Rows: 'Rows',
  Term: 'Term',
  Value: 'Value',
  Reason: 'Reason',
}));

const text = (value: ReactTestInstance | string): string =>
  typeof value === 'string' ? value : value.children.map(text).join('');

const STARTED = Date.UTC(2026, 10, 17, 18, 20, 23);

const compaction = (fields: Partial<ReplyCompaction> = {}): ReplyCompaction => ({
  id: 'c1',
  phase: 'mid_turn',
  afterTool: 3,
  status: 'success',
  startedAt: STARTED,
  durationMs: 8400,
  summaryModel: 'haiku',
  beforeTokens: 366804,
  afterTokens: 6336,
  historyBudgetTokens: 351792,
  runsBefore: 24,
  compactedRunCount: 24,
  ...fields,
});

const running = (fields: Partial<ReplyCompaction> = {}) =>
  compaction({
    status: 'running',
    afterTokens: undefined,
    durationMs: undefined,
    compactedRunCount: 9,
    ...fields,
  });

const failed = (fields: Partial<ReplyCompaction> = {}) =>
  compaction({
    status: 'failed',
    afterTokens: undefined,
    compactedRunCount: undefined,
    durationMs: 31200,
    failureReason: 'The summary model returned an error (529 overloaded).',
    ...fields,
  });

const triggerRect = { x: 10, y: 20, width: 100, height: 16 };
const renderers: ReactTestRenderer[] = [];
const render = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, {
      createNodeMock: () => ({
        getBoundingClientRect: () => ({ ...triggerRect }),
        contains: () => false,
      }),
    });
  });
  renderers.push(renderer);
  return renderer;
};
const seam = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'div' && node.props['data-compaction-seam'] === true);
const trigger = (renderer: ReactTestRenderer) => renderer.root.findByType('button');
const card = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'div' && node.props.role === 'tooltip');
const label = (renderer: ReactTestRenderer) => text(trigger(renderer)).replace(/\s+/g, ' ');

/** The card's rows as `[term, value]` pairs. */
const rows = (renderer: ReactTestRenderer): Array<[string, string]> => {
  const [tip] = card(renderer);
  const terms = tip!.findAllByType('dt').map(text);
  const values = tip!.findAllByType('dd').map(text);
  return terms.map((term, i) => [term, values[i] ?? '']);
};

const open = async (renderer: ReactTestRenderer) => {
  await act(() => trigger(renderer).props.onClick());
  const cards = card(renderer);
  expect(cards).toHaveLength(1);
  return cards[0]!;
};

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  vi.useRealTimers();
});

describe('CompactionSeam row', () => {
  it('names its state for the e2e specs', () => {
    expect(seam(render(<CompactionSeam compaction={compaction()} />)).props['data-state']).toBe(
      'success'
    );
    expect(
      seam(render(<CompactionSeam compaction={running()} interrupted />)).props['data-state']
    ).toBe('interrupted');
    expect(
      seam(render(<CompactionSeam compaction={failed({ status: 'timeout' })} />)).props[
        'data-state'
      ]
    ).toBe('timeout');
  });

  it('says what a successful compaction saved, by where it ran', () => {
    expect(label(render(<CompactionSeam compaction={compaction()} />))).toBe(
      'Compacted context · 367k → 6k tokens'
    );
    expect(
      label(render(<CompactionSeam compaction={compaction({ phase: 'pre_turn', afterTool: 0 })} />))
    ).toBe('Compacted before replying · 367k → 6k tokens');
    expect(
      label(render(<CompactionSeam compaction={compaction({ phase: 'pre_turn', afterTool: 2 })} />))
    ).toBe('Compacted context · 367k → 6k tokens');
    expect(label(render(<CompactionSeam compaction={compaction({ phase: 'manual' })} />))).toBe(
      'Compacted on request · 367k → 6k tokens'
    );
    expect(label(render(<CompactionSeam compaction={compaction({ phase: 'notice' })} />))).toBe(
      'Compacted context · 367k → 6k tokens'
    );
  });

  it('leaves the token part out without token counts', () => {
    expect(
      label(
        render(
          <CompactionSeam
            compaction={compaction({ beforeTokens: undefined, afterTokens: undefined })}
          />
        )
      )
    ).toBe('Compacted context');
  });

  it('says the reply kept its full history when the compaction did not finish', () => {
    expect(label(render(<CompactionSeam compaction={failed()} />))).toBe(
      'Compaction failed · kept full history'
    );
    expect(label(render(<CompactionSeam compaction={failed({ status: 'timeout' })} />))).toBe(
      'Compaction timed out · kept full history'
    );
    expect(
      label(
        render(
          <CompactionSeam compaction={running({ compactedRunCount: undefined })} interrupted />
        )
      )
    ).toBe('Compaction interrupted · kept full history');
  });

  it('claims the full history was kept only when no runs were folded', () => {
    expect(label(render(<CompactionSeam compaction={failed({ compactedRunCount: 0 })} />))).toBe(
      'Compaction failed · kept full history'
    );
    expect(label(render(<CompactionSeam compaction={failed({ compactedRunCount: 3 })} />))).toBe(
      'Compaction failed'
    );
    expect(
      label(
        render(<CompactionSeam compaction={failed({ status: 'timeout', compactedRunCount: 2 })} />)
      )
    ).toBe('Compaction timed out');
  });

  it('shows the warning icon only when the compaction did not finish', () => {
    const icon = (c: ReplyCompaction, interrupted = false) =>
      trigger(render(<CompactionSeam compaction={c} interrupted={interrupted} />)).findByType('svg')
        .props['data-icon'];
    expect(icon(compaction())).toBe('fold');
    expect(icon(running())).toBe('fold');
    expect(icon(failed())).toBe('alert');
    expect(icon(running(), true)).toBe('alert');
  });
});

describe('CompactionSeam icons', () => {
  it('size in rem, so they scale with the root font size', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await open(renderer);
    const sizes = renderer.root.findAllByType('svg').map((icon) => icon.props['data-size']);
    expect(sizes).toEqual(['0.875rem', '0.875rem']);
  });
});

describe('CompactionSeam while running', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED + 12_000);
  });

  it('counts the seconds since it started', () => {
    const renderer = render(<CompactionSeam compaction={running()} />);
    expect(label(renderer)).toBe('Compacting context… 12 s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(label(renderer)).toBe('Compacting context… 13 s');
  });

  it('stops counting when it unmounts', () => {
    const renderer = render(<CompactionSeam compaction={running()} />);
    expect(vi.getTimerCount()).toBe(1);

    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops counting when the compaction finishes or its reply ends', () => {
    const renderer = render(<CompactionSeam compaction={running()} />);
    expect(vi.getTimerCount()).toBe(1);

    act(() => renderer.update(<CompactionSeam compaction={compaction()} />));
    expect(vi.getTimerCount()).toBe(0);

    act(() => renderer.update(<CompactionSeam compaction={running()} />));
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer.update(<CompactionSeam compaction={running()} interrupted />));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs no timer once finished', () => {
    render(<CompactionSeam compaction={compaction()} />);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CompactionSeam end time', () => {
  it('shows no When row when the start and the duration end past the latest date', async () => {
    const renderer = render(
      <CompactionSeam compaction={compaction({ startedAt: 8.64e15 - 1000, durationMs: 8.64e15 })} />
    );
    await open(renderer);

    expect(rows(renderer).map(([term]) => term)).not.toContain('When');
  });
});

describe('CompactionSeam reason', () => {
  it('clamps the failure reason, and only it, to a few lines', async () => {
    const renderer = render(<CompactionSeam compaction={failed()} />);
    const clamped = (await open(renderer)).findAll(
      (node) => node.type === 'dd' && String(node.props.className).includes('Reason')
    );

    expect(clamped.map(text)).toEqual(['The summary model returned an error (529 overloaded).']);
  });
});

describe('CompactionNoticeSeam', () => {
  const MINUTE = 60_000;
  const notice = (fields: Partial<ReplyCompaction> = {}) =>
    running({
      id: 'notice',
      phase: 'manual',
      afterTool: 0,
      compactedRunCount: undefined,
      ...fields,
    });
  const state = (renderer: ReactTestRenderer) => seam(renderer).props['data-state'] as string;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('keeps a running notice running until 15 min after it was sent, then interrupted', () => {
    vi.setSystemTime(STARTED + 14 * MINUTE);
    const renderer = render(<CompactionNoticeSeam compaction={notice()} />);
    expect(state(renderer)).toBe('running');

    act(() => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(state(renderer)).toBe('interrupted');
    expect(label(renderer)).toBe('Compaction interrupted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns interrupted when the deadline passes between its render and its effect', () => {
    const deadline = STARTED + 15 * MINUTE;
    vi.setSystemTime(deadline - 1);
    // The first reading, the render's, is just before the deadline; every later one, the
    // effect's included, is past it.
    let readings = 0;
    const now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => (readings++ === 0 ? deadline - 1 : deadline + 1));
    const renderer = render(<CompactionNoticeSeam compaction={notice()} />);
    now.mockRestore();

    expect(readings).toBeGreaterThan(1);
    expect(state(renderer)).toBe('interrupted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a running notice older than 15 min as interrupted at once', () => {
    vi.setSystemTime(STARTED + 20 * MINUTE);
    const renderer = render(<CompactionNoticeSeam compaction={notice()} />);
    expect(state(renderer)).toBe('interrupted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a finished notice as it is, however old, and runs no timer', () => {
    vi.setSystemTime(STARTED + 20 * MINUTE);
    const renderer = render(<CompactionNoticeSeam compaction={notice({ status: 'success' })} />);
    expect(state(renderer)).toBe('success');
    expect(state(render(<CompactionNoticeSeam compaction={notice({ status: 'failed' })} />))).toBe(
      'failed'
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CompactionSeam card', () => {
  const when = (ms: number) => timeHourMinuteSecond(ms, false, 'en');

  it('opens below the row on hover and closes when the mouse leaves', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    expect(card(renderer)).toHaveLength(0);

    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));
    expect(card(renderer)).toHaveLength(1);
    const [layer] = renderer.root.findAll((node) => node.props['data-popout'] === true);
    expect(layer!.props['data-position']).toBe('Bottom');
    expect(layer!.props.style).toEqual({ pointerEvents: 'none' });
    expect(trigger(renderer).props['aria-expanded']).toBe(true);

    vi.useFakeTimers();
    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(card(renderer)).toHaveLength(0);
  });

  it('stays open while the mouse moves from the row onto the card, and closes once it leaves both', () => {
    vi.useFakeTimers();
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    const [tip] = card(renderer);
    expect(tip!.props.style).toEqual({ pointerEvents: 'auto' });

    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      card(renderer)[0]!.props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);

    // Back to the row and off the card: still open.
    act(() => {
      card(renderer)[0]!.props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);

    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      card(renderer)[0]!.props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      card(renderer)[0]!.props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(card(renderer)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a pending close when it unmounts', () => {
    // The timeouts alone: an open card also follows its row once a frame.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not open from a touch pointer entering, only from the tap', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'touch' }));
    expect(card(renderer)).toHaveLength(0);

    await open(renderer);
    await act(() => trigger(renderer).props.onClick());
    expect(card(renderer)).toHaveLength(0);
  });

  it('opens on keyboard focus and closes on blur', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await act(() => trigger(renderer).props.onFocus());
    expect(card(renderer)).toHaveLength(1);
    expect(trigger(renderer).props['aria-describedby']).toBe(card(renderer)[0]!.props.id);

    await act(() => trigger(renderer).props.onBlur({ relatedTarget: null }));
    expect(card(renderer)).toHaveLength(0);
  });

  it('stays pinned while focus moves into the card, and closes when it leaves both', () => {
    const view = renderDom(
      <>
        <CompactionSeam compaction={compaction()} />
        <button type="button">elsewhere</button>
      </>
    );
    const row = view.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    act(() => row.focus());
    fireEvent.click(row);
    // A press inside the card to select text moves focus there from the row.
    const tip = screen.getByRole('tooltip');
    act(() => tip.focus());
    expect(document.activeElement).toBe(tip);
    expect(screen.queryByRole('tooltip')).not.toBeNull();

    act(() => screen.getByText('elsewhere').focus());
    expect(screen.queryByRole('tooltip')).toBeNull();
    view.unmount();
  });

  it('takes focus in the card back to the row on Escape, and keeps that Escape from the room', () => {
    const view = renderDom(<CompactionSeam compaction={compaction()} />);
    const row = view.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    fireEvent.click(row);
    act(() => screen.getByRole('tooltip').focus());

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(escape.defaultPrevented).toBe(true);

    // With focus elsewhere the room's Escape still runs.
    fireEvent.click(row);
    act(() => row.blur());
    fireEvent.click(row);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    const elsewhere = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(elsewhere);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(elsewhere.defaultPrevented).toBe(false);
    view.unmount();
  });

  it('pins a hovered card once focus reaches it, so the mouse leaving keeps it', () => {
    vi.useFakeTimers();
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      card(renderer)[0]!.props.onPointerEnter({ pointerType: 'mouse' });
    });
    // A close the mouse started before focus came is taken back too.
    act(() => {
      card(renderer)[0]!.props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      card(renderer)[0]!.props.onFocus();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);
    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);
  });

  it('stays open when focus arrives while hovered and the mouse then leaves', () => {
    vi.useFakeTimers();
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      trigger(renderer).props.onFocus();
    });
    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);
  });

  it('keeps a pinned card pinned when focus arrives', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await open(renderer);
    await act(() => trigger(renderer).props.onFocus());
    await act(() => trigger(renderer).props.onClick());
    expect(card(renderer)).toHaveLength(0);
  });

  it('stays open when a focused row is hovered and left', () => {
    vi.useFakeTimers();
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    act(() => {
      trigger(renderer).props.onFocus();
    });
    act(() => {
      trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' });
    });
    act(() => {
      trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(renderer)).toHaveLength(1);
  });

  it('closes on Escape and on a tap elsewhere', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await open(renderer);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(card(renderer)).toHaveLength(0);

    await open(renderer);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(card(renderer)).toHaveLength(0);
  });

  it('follows the row once a frame while open, however it moved, and stops once closed', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    await open(renderer);
    const top = () =>
      renderer.root.findAll((node) => node.props['data-popout'] === true)[0]!.props['data-top'];
    // No render of the seam and no scroll: text above it wrapped, or an image loaded.
    triggerRect.y = 60;
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(top()).toBe(60);
    triggerRect.y = 20;
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(top()).toBe(20);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(card(renderer)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('details a successful compaction', async () => {
    const renderer = render(<CompactionSeam compaction={compaction()} />);
    const tip = await open(renderer);

    expect(tip.props['data-state']).toBe('success');
    expect(text(tip)).toContain('Context compacted');
    expect(text(tip)).toContain('mid-turn');
    expect(text(tip)).toContain('Between two model requests, after tool call 3.');
    expect(text(tip)).toContain('was 104% of budget');
    expect(text(tip)).toContain('now 2%');
    expect(rows(renderer)).toEqual([
      ['History', '366,804 → 6,336 tokens'],
      ['Saved', '360,468 tokens (98%)'],
      ['Budget', '351,792 tokens'],
      ['Folded', '24 runs into 1 summary'],
      ['Summarized by', 'haiku in 8.4 s'],
      ['When', when(STARTED + 8400)],
    ]);
    expect(tip.findAllByType('b').map(text)).toEqual(['366,804 → 6,336']);
  });

  it('details a success that saved nothing, or whose summary time is unknown', async () => {
    const renderer = render(
      <CompactionSeam
        compaction={compaction({
          afterTokens: 366804,
          durationMs: undefined,
          startedAt: undefined,
        })}
      />
    );
    await open(renderer);
    expect(rows(renderer)).toEqual([
      ['History', '366,804 → 366,804 tokens'],
      ['Saved', '0 tokens (0%)'],
      ['Budget', '351,792 tokens'],
      ['Folded', '24 runs into 1 summary'],
      ['Summarized by', 'haiku'],
    ]);
  });

  it('says how long an unfinished compaction tried only when it gave up', async () => {
    const renderer = render(
      <CompactionSeam compaction={running({ durationMs: 5000 })} interrupted />
    );
    await open(renderer);
    expect(rows(renderer).map(([term]) => term)).not.toContain('Gave up after');
  });

  it('tags where it ran', async () => {
    const tagged = async (c: ReplyCompaction) => {
      const renderer = render(<CompactionSeam compaction={c} />);
      return text(await open(renderer));
    };
    const preTurn = await tagged(compaction({ phase: 'pre_turn', afterTool: 0 }));
    expect(preTurn).toContain('before the reply');
    expect(preTurn).toContain('Before this reply’s first model request.');
    const manual = await tagged(compaction({ phase: 'manual' }));
    expect(manual).toContain('manual');
    expect(manual).toContain('Requested with the compact command.');
    const noTools = await tagged(compaction({ afterTool: 0 }));
    expect(noTools).toContain('Between two model requests.');
  });

  it('shows no tag and no subtitle for an old automatic notice', async () => {
    const renderer = render(<CompactionSeam compaction={compaction({ phase: 'notice' })} />);
    const tip = await open(renderer);
    expect(tip.findAll((node) => node.props.className === 'Tag')).toHaveLength(0);
    expect(tip.findAll((node) => node.props.className === 'Subtitle')).toHaveLength(0);
  });

  it('says one run in the singular', async () => {
    const renderer = render(
      <CompactionSeam compaction={compaction({ compactedRunCount: 1, runsBefore: 1 })} />
    );
    await open(renderer);
    expect(rows(renderer)).toContainEqual(['Folded', '1 run into 1 summary']);
  });

  it('details a running compaction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED + 12_000);
    const renderer = render(<CompactionSeam compaction={running()} />);
    const tip = await open(renderer);

    expect(text(tip)).toContain('Compacting context… 12 s');
    expect(text(tip)).toContain('104% of budget');
    expect(rows(renderer)).toEqual([
      ['History', '366,804 tokens'],
      ['Budget', '351,792 tokens'],
      ['Folding', '24 runs, 9 done'],
      ['Summary model', 'haiku'],
      ['Started', when(STARTED)],
    ]);
  });

  it('details a failure, its reason first', async () => {
    const renderer = render(<CompactionSeam compaction={failed()} />);
    const tip = await open(renderer);

    expect(text(tip)).toContain('Compaction failed');
    expect(text(tip)).toContain('The reply went on with its full history.');
    expect(text(tip)).toContain('104% of budget, unchanged');
    expect(rows(renderer)).toEqual([
      ['Reason', 'The summary model returned an error (529 overloaded).'],
      ['History', '366,804 tokens'],
      ['Budget', '351,792 tokens'],
      ['Summary model', 'haiku'],
      ['Gave up after', '31 s'],
      ['When', when(STARTED + 31200)],
    ]);
  });

  it('says the reply went on with its full history only when no runs were folded', async () => {
    const kept = 'The reply went on with its full history.';
    for (const status of ['failed', 'timeout'] as const) {
      for (const compactedRunCount of [undefined, 0]) {
        const renderer = render(
          <CompactionSeam compaction={failed({ status, compactedRunCount })} />
        );
        expect(text(await open(renderer))).toContain(kept);
      }
      const folded = render(
        <CompactionSeam compaction={failed({ status, compactedRunCount: 3 })} />
      );
      const tip = await open(folded);
      expect(text(tip)).not.toContain(kept);
      expect(tip.findAll((node) => node.props.className === 'Subtitle')).toHaveLength(0);
    }
  });

  it('claims no going on for an interrupted compaction, whose reply ended', async () => {
    for (const compactedRunCount of [undefined, 0]) {
      const renderer = render(
        <CompactionSeam compaction={running({ compactedRunCount })} interrupted />
      );
      const tip = await open(renderer);
      expect(tip.findAll((node) => node.props.className === 'Subtitle')).toHaveLength(0);
    }
  });

  it('calls the history unchanged only when no runs were folded', async () => {
    for (const status of ['failed', 'timeout'] as const) {
      const kept = render(<CompactionSeam compaction={failed({ status, compactedRunCount: 0 })} />);
      expect(text(await open(kept))).toContain('104% of budget, unchanged');

      const folded = render(
        <CompactionSeam compaction={failed({ status, compactedRunCount: 3 })} />
      );
      const tip = await open(folded);
      expect(text(tip)).not.toContain('unchanged');
      expect(tip.findAll((node) => node.props.className === 'GaugeLabel')).toHaveLength(0);
      expect(tip.findAll((node) => node.props.className === 'Gauge')).toHaveLength(1);
    }
  });

  it('claims no kept history for a notice, which cannot show that nothing was folded', async () => {
    for (const phase of ['manual', 'notice'] as const) {
      for (const status of ['failed', 'timeout'] as const) {
        const renderer = render(
          <CompactionSeam compaction={failed({ phase, status, afterTool: 0 })} />
        );
        expect(label(renderer)).toBe(
          status === 'failed' ? 'Compaction failed' : 'Compaction timed out'
        );
        const tip = await open(renderer);
        expect(text(tip)).not.toContain('full history');
        expect(text(tip)).not.toContain('unchanged');
        expect(tip.findAll((node) => node.props.className === 'Subtitle')).toHaveLength(0);
      }
    }
  });

  it('gives the reason of an interrupted compaction', async () => {
    const renderer = render(<CompactionSeam compaction={running()} interrupted />);
    expect(text(await open(renderer))).toContain('Compaction interrupted');
    expect(rows(renderer)[0]).toEqual(['Reason', 'The reply ended before the summary finished.']);
  });

  it('labels no gauge of a success without its count after', async () => {
    const renderer = render(<CompactionSeam compaction={compaction({ afterTokens: undefined })} />);
    const tip = await open(renderer);
    expect(tip.findAll((node) => node.props.className === 'Gauge')).toHaveLength(1);
    expect(tip.findAll((node) => node.props.className === 'GaugeLabel')).toHaveLength(0);
  });

  it('draws no gauge without a budget', async () => {
    const renderer = render(
      <CompactionSeam compaction={compaction({ historyBudgetTokens: undefined })} />
    );
    const tip = await open(renderer);
    expect(tip.findAll((node) => node.props.className === 'Gauge')).toHaveLength(0);
    expect(text(tip)).not.toContain('of budget');
    expect(rows(renderer).map(([term]) => term)).not.toContain('Budget');
  });

  it('leaves the token rows and the gauge out without token counts', async () => {
    const renderer = render(
      <CompactionSeam
        compaction={failed({ beforeTokens: undefined, phase: 'notice', afterTool: 0 })}
      />
    );
    const tip = await open(renderer);
    expect(tip.findAll((node) => node.props.className === 'Gauge')).toHaveLength(0);
    expect(rows(renderer).map(([term]) => term)).toEqual([
      'Reason',
      'Budget',
      'Summary model',
      'Gave up after',
      'When',
    ]);
  });
});
