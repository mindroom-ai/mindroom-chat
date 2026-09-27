// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { hasUnsavedFormInput } from './useStorageRecoveryBlocker';

afterEach(() => {
  document.body.innerHTML = '';
});

const focus = (selector: string) => (document.querySelector(selector) as HTMLElement).focus();

describe('hasUnsavedFormInput', () => {
  it('ignores the persisted room composer, empty fields, and search boxes', () => {
    document.body.innerHTML = `
      <div id="portalContainer">
        <div role="menu"><input id="emoji" type="text" /></div>
      </div>
      <div data-editable-name="RoomInput" contenteditable="true" tabindex="0">draft</div>
      <input id="empty" type="text" />
      <input id="search" type="search" value="query" />
      <input id="searchbox" type="text" role="searchbox" value="query" />`;

    focus('[data-editable-name="RoomInput"]');
    expect(hasUnsavedFormInput(document)).toBe(false);
    focus('#empty');
    expect(hasUnsavedFormInput(document)).toBe(false);
    focus('#search');
    expect(hasUnsavedFormInput(document)).toBe(false);
    focus('#searchbox');
    expect(hasUnsavedFormInput(document)).toBe(false);
  });

  it('blocks while a focused field outside the composer holds typed text', () => {
    document.body.innerHTML = `<div id="portalContainer"></div><textarea id="topic">New topic</textarea>`;

    focus('#topic');

    expect(hasUnsavedFormInput(document)).toBe(true);
  });

  it('blocks while an open dialog holds typed text, even without focus', () => {
    document.body.innerHTML = `
      <div id="portalContainer"><div role="dialog"><input type="password" value="hunter2" /></div></div>`;
    expect(hasUnsavedFormInput(document)).toBe(true);

    document.body.innerHTML = `
      <div id="portalContainer"><div role="dialog"><input type="password" /></div></div>`;
    expect(hasUnsavedFormInput(document)).toBe(false);
  });
});
