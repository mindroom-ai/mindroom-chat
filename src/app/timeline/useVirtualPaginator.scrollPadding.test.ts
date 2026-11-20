// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readScrollPadding } from './useVirtualPaginator';
import {
  HEADER_OUT_OF_PADDING,
  THREAD_HEADER_ATTRIBUTE,
  THREAD_HEADER_SCROLLER_ATTRIBUTE,
} from '../ui/styles/threadHeaderInset';

afterEach(() => {
  document.body.innerHTML = '';
});

// Typing in the thread banner's title takes the banner out of the scroller's padding, so the caret
// stays in view (ThreadTimelineHeader.css.ts); the reader's view still starts below the banner.
it('reads the banner as covering the rows while its title field has the focus', () => {
  const column = document.createElement('div');
  column.style.setProperty('--room-thread-header-height', '88px');
  const scroller = document.createElement('div');
  scroller.setAttribute(THREAD_HEADER_SCROLLER_ATTRIBUTE, '');
  scroller.style.scrollPaddingTop = '142px';
  scroller.style.scrollPaddingBottom = '96px';
  const header = document.createElement('div');
  header.setAttribute(THREAD_HEADER_ATTRIBUTE, '');
  const title = document.createElement('input');
  header.append(title);
  scroller.append(header);
  column.append(scroller);
  document.body.append(column);

  expect(readScrollPadding(scroller)).toEqual({ top: 142, bottom: 96 });
  title.focus();
  // What a browser computes then; jsdom's styles do not apply the rule.
  scroller.style.scrollPaddingTop = '54px';
  scroller.style.setProperty(HEADER_OUT_OF_PADDING, '1');
  expect(readScrollPadding(scroller)).toEqual({ top: 142, bottom: 96 });
});
