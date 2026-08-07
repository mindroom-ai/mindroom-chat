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

    expect(container.textContent).toContain('keep');
    expect(warn).toHaveBeenCalledTimes(1);
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

  it('appends when the insertBefore anchor was reparented', () => {
    guard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = document.createElement('div');
    const anchor = document.createElement('b');
    const elsewhere = document.createElement('div');
    elsewhere.appendChild(anchor);
    const inserted = document.createElement('i');

    expect(parent.insertBefore(inserted, anchor)).toBe(inserted);
    expect(Array.from(parent.childNodes)).toEqual([inserted]);
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
