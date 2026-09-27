// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { hasUnsavedFormInput } from './useStorageRecoveryBlocker';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hasUnsavedFormInput', () => {
  it('ignores the persisted room composer and non-editable focus', () => {
    document.body.innerHTML = `
      <div id="portalContainer"><div role="menu"><button>Pin</button></div></div>
      <div data-editable-name="RoomInput" contenteditable="true" tabindex="0"></div>
      <button id="plain">Send</button>`;

    (document.querySelector('[data-editable-name="RoomInput"]') as HTMLElement).focus();
    expect(hasUnsavedFormInput(document)).toBe(false);
    (document.getElementById('plain') as HTMLElement).focus();
    expect(hasUnsavedFormInput(document)).toBe(false);
  });

  it('blocks while another editable element has focus', () => {
    document.body.innerHTML = `<div id="portalContainer"></div><input id="search" type="text" />`;

    (document.getElementById('search') as HTMLElement).focus();

    expect(hasUnsavedFormInput(document)).toBe(true);
  });

  it('blocks while an open dialog contains form fields', () => {
    document.body.innerHTML = `
      <div id="portalContainer"><div role="dialog"><input type="password" /></div></div>`;

    expect(hasUnsavedFormInput(document)).toBe(true);
  });
});
