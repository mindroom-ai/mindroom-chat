// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDomMutationGuard } from './domMutationGuard';

/**
 * Reproduces the reported production crash on a streaming thread:
 *   NotFoundError: Failed to execute 'removeChild' on 'Node'
 * Google Translate moves a React-owned text node into an injected <font>, so
 * the next commit removes it from the wrong parent.
 */
function Doc({ show }: { show: boolean }): React.ReactElement {
  return React.createElement(
    'div',
    null,
    show ? 'hello world' : null,
    React.createElement('span', null, 'keep')
  );
}

/** Mimics Google Translate wrapping a text node in a <font> element. */
const translateTextNode = (host: HTMLElement): void => {
  const textNode = Array.from(host.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode) throw new Error('no text node to translate');
  const font = document.createElement('font');
  host.insertBefore(font, textNode);
  font.appendChild(textNode);
};

const renderDoc = (): { root: Root; container: HTMLElement } => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Doc, { show: true }));
  });
  return { root, container };
};

const uninstallers: Array<() => void> = [];

const guard = (): void => {
  uninstallers.push(installDomMutationGuard());
};

afterEach(() => {
  while (uninstallers.length > 0) uninstallers.pop()?.();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('installDomMutationGuard', () => {
  it('without the guard, a translated text node crashes the React commit', () => {
    const { root, container } = renderDoc();
    translateTextNode(container.firstElementChild as HTMLElement);

    expect(() => {
      act(() => {
        root.render(React.createElement(Doc, { show: false }));
      });
    }).toThrowError(/not a child/);
  });

  it('keeps rendering when a translated text node is removed', () => {
    guard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { root, container } = renderDoc();
    translateTextNode(container.firstElementChild as HTMLElement);

    expect(() => {
      act(() => {
        root.render(React.createElement(Doc, { show: false }));
      });
    }).not.toThrow();

    // Returning early here instead would leave <font>hello world</font> on
    // screen — a crash traded for permanent stale content.
    expect(container.textContent).not.toContain('hello world');
    expect(container.textContent).toContain('keep');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('detaches a node the translator moved outside this parent', () => {
    guard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = document.createElement('div');
    const elsewhere = document.createElement('section');
    const child = document.createElement('b');
    elsewhere.appendChild(child);

    expect(parent.removeChild(child)).toBe(child);
    expect(child.parentNode).toBeNull();
    expect(elsewhere.childNodes).toHaveLength(0);
  });

  it('warns only once per session', () => {
    guard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = document.createElement('div');
    const orphan = document.createElement('span');

    parent.removeChild(orphan);
    parent.removeChild(orphan);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps document order when the insertBefore anchor moved into a wrapper', () => {
    guard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = document.createElement('div');
    parent.innerHTML = '<em>L</em><font><i>I</i><b>A</b></font>';
    const anchor = parent.querySelector('b') as HTMLElement;
    const inserted = document.createElement('u');
    inserted.textContent = 'U';

    expect(parent.insertBefore(inserted, anchor)).toBe(inserted);
    // Asserting the parent's childNodes would pass for either recovery, since
    // the wrapper occupies one slot regardless. Document order is what breaks.
    expect(parent.textContent).toBe('LIUA');
  });

  it('places the node mid-run when the translator merged the whole run', () => {
    guard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const Para = ({ show }: { show: boolean }): React.ReactElement =>
      React.createElement(
        'p',
        null,
        'prefix ',
        show ? React.createElement('mark', null, 'NEW') : null,
        ' suffix'
      );
    act(() => {
      root.render(React.createElement(Para, { show: false }));
    });

    // Chrome merges an entire inline run into ONE <font>, so the anchor sits
    // mid-wrapper rather than at its start.
    const paragraph = container.firstElementChild as HTMLElement;
    const font = document.createElement('font');
    paragraph.insertBefore(font, paragraph.firstChild);
    while (paragraph.childNodes[1]) font.appendChild(paragraph.childNodes[1]);

    act(() => {
      root.render(React.createElement(Para, { show: true }));
    });

    expect(container.textContent).toBe('prefix NEW suffix');
  });

  it('appends when the insertBefore anchor left this subtree entirely', () => {
    guard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = document.createElement('div');
    const existing = document.createElement('em');
    parent.appendChild(existing);
    const anchor = document.createElement('b');
    document.createElement('section').appendChild(anchor);
    const inserted = document.createElement('i');

    expect(parent.insertBefore(inserted, anchor)).toBe(inserted);
    expect(Array.from(parent.childNodes)).toEqual([existing, inserted]);
  });

  it('adds no enumerable marker to the global Node prototype', () => {
    const keysBefore = Object.keys(Node.prototype);
    guard();

    const enumerated: string[] = [];
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in document.createElement('div')) enumerated.push(key);
    expect(enumerated.filter((key) => /mindroom/i.test(key))).toEqual([]);

    // A string key would be enumerable and collidable; a symbol is neither,
    // but only if it is also defined non-enumerable.
    expect(Object.keys(Node.prototype)).toEqual(keysBefore);
    const enumerableSymbols = Object.getOwnPropertySymbols(Node.prototype).filter(
      (symbol) => Object.getOwnPropertyDescriptor(Node.prototype, symbol)?.enumerable
    );
    expect(enumerableSymbols).toEqual([]);
  });

  it('leaves well-formed removeChild and insertBefore untouched', () => {
    guard();
    const parent = document.createElement('div');
    const first = document.createElement('b');
    const second = document.createElement('i');
    parent.append(first, second);

    const inserted = document.createElement('u');
    parent.insertBefore(inserted, second);
    expect(Array.from(parent.childNodes)).toEqual([first, inserted, second]);

    expect(parent.removeChild(first)).toBe(first);
    expect(Array.from(parent.childNodes)).toEqual([inserted, second]);
  });

  it('is idempotent', () => {
    guard();
    const patched = Node.prototype.removeChild;
    const secondUninstall = installDomMutationGuard();

    expect(Node.prototype.removeChild).toBe(patched);

    secondUninstall();
    expect(Node.prototype.removeChild).toBe(patched);
  });

  it('restores the native methods on uninstall', () => {
    const nativeRemoveChild = Node.prototype.removeChild;
    const nativeInsertBefore = Node.prototype.insertBefore;
    const uninstall = installDomMutationGuard();

    expect(Node.prototype.removeChild).not.toBe(nativeRemoveChild);

    uninstall();
    expect(Node.prototype.removeChild).toBe(nativeRemoveChild);
    expect(Node.prototype.insertBefore).toBe(nativeInsertBefore);
  });
});
