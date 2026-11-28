// @vitest-environment jsdom

import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTextPromiseToClipboard, copyToClipboard } from './dom';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock('@capacitor/clipboard', () => ({
  Clipboard: {
    write: vi.fn(),
  },
}));

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(Clipboard.write).mockResolvedValue();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    vi.restoreAllMocks();
  });

  it('uses native clipboard in Capacitor apps', async () => {
    const webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(Clipboard.write).toHaveBeenCalledWith({ string: '@alice:example.org' });
    expect(webWrite).not.toHaveBeenCalled();
  });

  it('falls through to browser clipboard when native clipboard rejects', async () => {
    const webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Clipboard.write).mockRejectedValue(new Error('Native clipboard unavailable'));

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(Clipboard.write).toHaveBeenCalledWith({ string: '@alice:example.org' });
    expect(webWrite).toHaveBeenCalledWith('@alice:example.org');
  });

  it('falls back when browser clipboard rejects and removes its temporary input', async () => {
    const webWrite = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: webWrite },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('[data-clipboard-fallback]')).toBeNull();
  });

  it('returns the legacy copy failure when browser clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('@alice:example.org')).resolves.toBe(false);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('[data-clipboard-fallback]')).toBeNull();
  });

  it('returns false without creating a fallback input when document.body is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const originalBody = document.body;
    const createElement = vi.spyOn(document, 'createElement');
    Object.defineProperty(document, 'body', {
      configurable: true,
      value: null,
    });

    try {
      await expect(copyToClipboard('@alice:example.org')).resolves.toBe(false);
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'body', {
        configurable: true,
        value: originalBody,
      });
    }
  });

  it('mounts the fallback input inside an active dialog and restores button focus', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    button.textContent = 'Copy ID';
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    let fieldParent: Node | null = null;
    let fieldValue: string | null = null;
    const execCommand = vi.fn(() => {
      const fallback = document.querySelector<HTMLTextAreaElement>('[data-clipboard-fallback]');
      fieldParent = fallback?.parentNode ?? null;
      fieldValue = fallback?.value ?? null;
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    try {
      await expect(copyToClipboard('task\n123')).resolves.toBe(true);
      expect(fieldParent).toBe(dialog);
      expect(fieldValue).toBe('task\n123');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('[data-clipboard-fallback]')).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      dialog.remove();
    }
  });

  it('returns false without calling execCommand when a focus trap steals focus from the fallback input', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    button.textContent = 'Copy ID';
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    const stealFocus = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.hasAttribute('data-clipboard-fallback')
      ) {
        button.focus();
      }
    };
    dialog.addEventListener('focusin', stealFocus);

    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    try {
      await expect(copyToClipboard('task-456')).resolves.toBe(false);
      expect(execCommand).not.toHaveBeenCalled();
      expect(document.querySelector('[data-clipboard-fallback]')).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      dialog.removeEventListener('focusin', stealFocus);
      dialog.remove();
    }
  });

  it('mounts the fallback inside the clicked trigger dialog even when activeElement is body', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    button.textContent = 'Copy ID';
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    // Simulate Safari click leaving focus on document.body.
    expect(document.activeElement).toBe(document.body);

    let fieldParent: Node | null = null;
    const execCommand = vi.fn(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-clipboard-fallback]');
      fieldParent = field?.parentNode ?? null;
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    try {
      await expect(copyToClipboard('task-safari', button)).resolves.toBe(true);
      expect(fieldParent).toBe(dialog);
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      dialog.remove();
    }
  });

  it('returns false without copying when textarea normalization would alter CR or CRLF text', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(copyToClipboard('task\r42')).resolves.toBe(false);
    await expect(copyToClipboard('task\r\n42')).resolves.toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[data-clipboard-fallback]')).toBeNull();
  });
});

describe('copyTextPromiseToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = globalThis.ClipboardItem;

  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(Clipboard.write).mockResolvedValue();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    if (originalClipboardItem === undefined) {
      Reflect.deleteProperty(globalThis, 'ClipboardItem');
    } else {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
    }
    vi.restoreAllMocks();
  });

  it('starts a promise-backed ClipboardItem write synchronously before textPromise settles', async () => {
    let capturedBlobPromise: Promise<Blob> | undefined;
    class MockClipboardItem {
      constructor(items: Record<string, Blob | Promise<Blob>>) {
        capturedBlobPromise = items['text/plain'] as Promise<Blob>;
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: MockClipboardItem,
    });
    const write = vi.fn(async () => {
      const blob = await capturedBlobPromise!;
      expect(await blob.text()).toBe('hydrated body');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });

    let resolveText!: (value: string) => void;
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });

    const resultPromise = copyTextPromiseToClipboard(textPromise);
    expect(write).toHaveBeenCalledTimes(1);
    expect(capturedBlobPromise).toBeDefined();

    resolveText('hydrated body');
    await expect(resultPromise).resolves.toBe(true);
  });

  it('falls back to copyToClipboard when textPromise resolves and clipboard.write rejects', async () => {
    class MockClipboardItem {
      constructor(_items: Record<string, Blob | Promise<Blob>>) {}
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: MockClipboardItem,
    });
    const write = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });

    await expect(copyTextPromiseToClipboard(Promise.resolve('fallback body'))).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('fallback body');
  });

  it('returns false without copying fallback text when textPromise rejects', async () => {
    let capturedBlobPromise: Promise<Blob> | undefined;
    class MockClipboardItem {
      constructor(items: Record<string, Blob | Promise<Blob>>) {
        capturedBlobPromise = items['text/plain'] as Promise<Blob>;
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: MockClipboardItem,
    });
    const write = vi.fn().mockRejectedValue(new Error('write rejected'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });

    await expect(
      copyTextPromiseToClipboard(Promise.reject(new Error('hydration failed')))
    ).resolves.toBe(false);
    await expect(capturedBlobPromise).rejects.toThrow('hydration failed');
    expect(writeText).not.toHaveBeenCalled();

    // Even if clipboard.write resolves, a rejected textPromise still returns false.
    write.mockResolvedValueOnce(undefined);
    await expect(
      copyTextPromiseToClipboard(Promise.reject(new Error('hydration failed again')))
    ).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('skips browser ClipboardItem on Capacitor native and uses native clipboard after resolution', async () => {
    class MockClipboardItem {
      constructor(_items: Record<string, Blob | Promise<Blob>>) {}
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: MockClipboardItem,
    });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    await expect(copyTextPromiseToClipboard(Promise.resolve('native body'))).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(Clipboard.write).toHaveBeenCalledWith({ string: 'native body' });
  });

  it('falls back to copyToClipboard when ClipboardItem throws synchronously', async () => {
    class ThrowingClipboardItem {
      constructor(_items: Record<string, Blob | Promise<Blob>>) {
        throw new TypeError('Promise values not supported');
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: ThrowingClipboardItem,
    });
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });

    await expect(copyTextPromiseToClipboard(Promise.resolve('sync throw fallback'))).resolves.toBe(
      true
    );
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('sync throw fallback');
  });
});
