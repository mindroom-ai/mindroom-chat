// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ProbeReport, installThreadJumpProbe } from '../../../e2e/helpers/threadJumpProbe';

type ProbeHandle = {
  start: (mode: 'open' | 'scrollUp', stallMs?: number) => void;
  stop: () => ProbeReport;
};

describe('threadJumpProbe scrollUp burst checks', () => {
  let nextRaf: FrameRequestCallback | undefined;
  let nowMs = 1_000;
  const origRaf = window.requestAnimationFrame;
  const origScrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  const origScrollTo = Element.prototype.scrollTo;
  const origScrollBy = Element.prototype.scrollBy;

  let scroller: HTMLDivElement;
  let inner: HTMLDivElement;
  let row: HTMLDivElement;
  let rawScrollTop = 500;
  let rowTop = 200;

  const stepFrame = (dtMs = 16) => {
    nowMs += dtMs;
    const cb = nextRaf;
    nextRaf = undefined;
    cb?.(nowMs);
  };

  const wheelUp = (deltaY = -240) => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY }));
  };

  const probe = () => (window as unknown as { __threadJumpProbe: ProbeHandle }).__threadJumpProbe;

  beforeAll(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      nextRaf = cb;
      return 1;
    };
    installThreadJumpProbe();
  });

  afterAll(() => {
    window.requestAnimationFrame = origRaf;
    if (origScrollTopDesc) Object.defineProperty(Element.prototype, 'scrollTop', origScrollTopDesc);
    Element.prototype.scrollTo = origScrollTo;
    Element.prototype.scrollBy = origScrollBy;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    rawScrollTop = 500;
    rowTop = 200;
    scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 4_000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 });
    // Track raw scrollTop directly on the scroller while letting the probe's Element.prototype
    // setter observe programmatic writes when we assign scroller.scrollTop.
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 800, left: 0, right: 600, width: 600, height: 800 } as DOMRect);
    inner = document.createElement('div');
    inner.dataset.timelineRows = '';
    inner.dataset.threadCount = '100';
    row = document.createElement('div');
    row.dataset.messageItem = '';
    row.dataset.eventId = '$row1';
    row.getBoundingClientRect = () =>
      ({
        top: rowTop,
        bottom: rowTop + 100,
        left: 0,
        right: 600,
        width: 600,
        height: 100,
      } as DOMRect);
    inner.appendChild(row);
    scroller.appendChild(inner);
    document.body.appendChild(scroller);
    // Seed scroller.scrollTop via the underlying prototype setter.
    origScrollTopDesc?.set?.call(scroller, rawScrollTop);
  });

  const setBrowserScrollTop = (value: number) => {
    rawScrollTop = value;
    origScrollTopDesc?.set?.call(scroller, value);
  };

  it('flags unclamped undershoot when the burst settles', () => {
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=500, rowTop=200

    // Wheel asks for -240, but scrollTop and rows only move 108 px (median + movedPx === 0).
    wheelUp(-240);
    setBrowserScrollTop(392);
    rowTop += 108;
    stepFrame();

    // Four quiet frames settle the burst and expose the 132 px shortfall.
    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxUnexplainedPx).toBe(132);
    expect(report.jumps.some((j) => j.reasons.includes('burstDrift(-132px)'))).toBe(true);
  });

  it('excuses travelling less than the wheel asked when top-clamped at scrollTop=0', () => {
    setBrowserScrollTop(100);
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=100, rowTop=200

    // Wheel asks for -240, but only 100 px remains before clamping at 0.
    wheelUp(-240);
    setBrowserScrollTop(0);
    rowTop += 100;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxUnexplainedPx).toBe(0);
    expect(report.jumps).toEqual([]);
  });

  it('never excuses rows travelling MORE than the wheel asked even when top-clamped', () => {
    setBrowserScrollTop(360);
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=360, rowTop=200

    // Wheel asks for -240, yet scrollTop and rows travel 360 px to scrollTop=0 (clamped).
    wheelUp(-240);
    setBrowserScrollTop(0);
    rowTop += 360;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxUnexplainedPx).toBe(120);
    expect(report.jumps.some((j) => j.reasons.includes('burstDrift(120px)'))).toBe(true);
  });

  it('never excuses backward row travel during a top-clamped burst', () => {
    setBrowserScrollTop(100);
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=100, rowTop=200

    // Wheel asks for -240 and hits scrollTop=0 (clamped), yet rows jump backward -80 px.
    wheelUp(-240);
    setBrowserScrollTop(0);
    rowTop -= 80;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxReversalPx).toBe(80);
    expect(report.maxUnexplainedPx).toBe(180);
    expect(report.jumps.some((j) => j.reasons.includes('burstDrift(-80px)'))).toBe(true);
  });

  it('flags a delayed row jump on a stationary frame instead of crediting earlier wheel input', () => {
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=500, rowTop=200

    // Previously entered a 2 s take-back window via a discarded settle write.
    scroller.scrollTop = 700;
    setBrowserScrollTop(500);
    stepFrame();

    // After 240 px of wheel, the row moves 60 px, pauses 2 frames, then jumps 180 px with no input.
    wheelUp(-240);
    setBrowserScrollTop(440);
    rowTop += 60;
    stepFrame();
    stepFrame();
    stepFrame();
    rowTop += 180;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxUnexplainedPx).toBeGreaterThanOrEqual(180);
    expect(report.jumps.some((j) => j.reasons.includes('unexplained(180px)'))).toBe(true);
  });

  it('counts a blank first frame when the revealed list is populated but rows sit below the viewport', () => {
    rowTop = 1_200; // mounted below the 0..800 viewport while threadCount=100
    probe().start('open');
    stepFrame(); // first revealed, populated frame: 0 visible rows

    rowTop = 200;
    stepFrame(); // rows enter viewport on frame 2
    stepFrame(); // frame 3

    const report = probe().stop();
    expect(report.minVisibleCount).toBe(0);
    expect(report.jumps.some((j) => j.reasons.includes('blankScreen(0 rows)'))).toBe(true);
  });
});
