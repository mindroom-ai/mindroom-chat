// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  readTopInset,
  THREAD_HEADER_ATTRIBUTE,
  THREAD_HEADER_SCROLLER_ATTRIBUTE,
} from './threadHeaderInset';

/**
 * A thread's scroller as ThreadTimelineHeader leaves it: padding for a 54 px room header and an
 * 88 px banner, and the banner's height on the scroller's parent. jsdom's styles do not apply the
 * rule that takes the banner out of the padding while a field of it has the focus
 * (ThreadTimelineHeader.css.ts), so `typeInTitle` writes the padding a browser computes then.
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
  const button = document.createElement('button');
  header.append(title, button);
  scroller.append(header);
  column.append(scroller);
  document.body.append(column);
  const typeInTitle = () => {
    title.focus();
    scroller.style.scrollPaddingTop = '54px';
  };
  return { scroller, title, button, typeInTitle };
};

describe('readTopInset', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is the scroll padding while no text field of the header has the focus', () => {
    const { scroller, button } = mountThread();
    expect(readTopInset(scroller)).toBe(142);
    button.focus();
    expect(readTopInset(scroller)).toBe(142);
    // The banner is added only while the rule applies.
    scroller.style.scrollPaddingTop = '54px';
    expect(readTopInset(scroller)).toBe(54);
  });

  it('adds the banner back while typing in it takes the banner out of the padding', () => {
    const { scroller, title, typeInTitle } = mountThread();
    typeInTitle();
    expect(getComputedStyle(scroller).scrollPaddingTop).toBe('54px');
    expect(readTopInset(scroller)).toBe(142);
    title.blur();
    scroller.style.scrollPaddingTop = '142px';
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
