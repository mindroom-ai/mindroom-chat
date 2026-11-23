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

  it('flags unclamped undershoot during a take-back burst when the burst settles', () => {
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=500, rowTop=200

    // Programmatic settle write (+200), then browser discards it back (-200) -> enters take-back.
    scroller.scrollTop = 700;
    setBrowserScrollTop(500);
    stepFrame();

    // Next notch (-240) plus late replay lands at 392 (net -108); rows move only +108.
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
    setBrowserScrollTop(100);
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=100, rowTop=200

    // Enter take-back window.
    scroller.scrollTop = 300;
    setBrowserScrollTop(100);
    stepFrame();

    // Wheel asks for -240 and hits scrollTop=0 (clamped), yet rows jump +360 (120 px overshoot).
    wheelUp(-240);
    setBrowserScrollTop(0);
    rowTop += 360;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxUnexplainedPx).toBe(120);
    expect(report.jumps.some((j) => j.reasons.includes('unexplained(120px)'))).toBe(true);
    expect(report.jumps.some((j) => j.reasons.includes('burstDrift(120px)'))).toBe(true);
  });

  it('never excuses backward row travel during a top-clamped burst', () => {
    setBrowserScrollTop(100);
    probe().start('scrollUp');
    stepFrame(); // baseline at scrollTop=100, rowTop=200

    // Enter take-back window.
    scroller.scrollTop = 300;
    setBrowserScrollTop(100);
    stepFrame();

    // Wheel asks for -240 and hits scrollTop=0 (clamped), yet rows jump backward -80 px.
    wheelUp(-240);
    setBrowserScrollTop(0);
    rowTop -= 80;
    stepFrame();

    for (let i = 0; i < 4; i += 1) stepFrame();
    const report = probe().stop();
    expect(report.maxReversalPx).toBe(80);
    expect(report.maxUnexplainedPx).toBe(80);
    expect(report.jumps.some((j) => j.reasons.includes('burstDrift(-80px)'))).toBe(true);
  });
});
