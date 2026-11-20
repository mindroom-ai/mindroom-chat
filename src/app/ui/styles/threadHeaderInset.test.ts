// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  HEADER_OUT_OF_PADDING,
  readTopInset,
  THREAD_HEADER_ATTRIBUTE,
  THREAD_HEADER_SCROLLER_ATTRIBUTE,
} from './threadHeaderInset';

/**
 * A thread's scroller as ThreadTimelineHeader leaves it: padding for a 54 px room header and an
 * 88 px banner, and the banner's height on the scroller's parent. jsdom's styles do not apply the
 * rule that takes the banner out of the padding while a field of it has the focus
 * (ThreadTimelineHeader.css.ts), so `applyRule` writes what a browser computes then.
 */
const mountThread = () => {
  const column = document.createElement('div');
  column.style.setProperty('--room-thread-header-height', '88px');
  const scroller = document.createElement('div');
  scroller.setAttribute(THREAD_HEADER_SCROLLER_ATTRIBUTE, '');
  scroller.style.scrollPaddingTop = '142px';
  const header = document.createElement('div');
  header.setAttribute(THREAD_HEADER_ATTRIBUTE, '');
  const title = document.createElement('input');
  header.append(title);
  scroller.append(header);
  column.append(scroller);
  document.body.append(column);
  const applyRule = () => {
    scroller.style.scrollPaddingTop = '54px';
    scroller.style.setProperty(HEADER_OUT_OF_PADDING, '1');
  };
  return { scroller, title, applyRule };
};

describe('readTopInset', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is the scroll padding while the rule does not apply', () => {
    const { scroller } = mountThread();
    expect(readTopInset(scroller)).toBe(142);
  });

  it('adds the banner back while the rule leaves it out of the padding', () => {
    const { scroller, title, applyRule } = mountThread();
    title.focus();
    applyRule();
    expect(getComputedStyle(scroller).scrollPaddingTop).toBe('54px');
    expect(readTopInset(scroller)).toBe(142);
  });

  it('adds nothing for a focused title where the browser cannot apply the rule', () => {
    // Without :has(), the padding keeps the banner and the flag stays unset.
    const { scroller, title } = mountThread();
    title.focus();
    expect(document.activeElement).toBe(title);
    expect(readTopInset(scroller)).toBe(142);
  });

  it('reads any other scroller by its padding alone', () => {
    const scroller = document.createElement('div');
    scroller.style.scrollPaddingTop = '30px';
    document.body.append(scroller);
    expect(readTopInset(scroller)).toBe(30);
    scroller.style.scrollPaddingTop = '';
    expect(readTopInset(scroller)).toBe(0);
  });
});
