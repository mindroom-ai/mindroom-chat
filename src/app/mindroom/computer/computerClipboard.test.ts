// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachComputerClipboard,
  isApplePlatform,
  MAX_PASTE_BYTES,
  type ClipboardRfb,
  type ComputerClipboardOptions,
} from './computerClipboard';

const V_KEYSYM = 0x76;
const SHIFT_V_KEYSYM = 0x56;
const CONTROL_L_KEYSYM = 0xffe3;
const SHIFT_L_KEYSYM = 0xffe1;

type RfbCall = ['paste', string] | ['key', number, string | null, boolean | undefined];

const createRfb = () => {
  const calls: RfbCall[] = [];
  let listener: EventListener | undefined;
  return {
    calls,
    addEventListener: vi.fn((_name: 'clipboard', next: EventListener) => {
      listener = next;
    }),
    removeEventListener: vi.fn((_name: 'clipboard', next: EventListener) => {
      if (listener === next) listener = undefined;
    }),
    clipboardPasteFrom: vi.fn((text: string) => {
      calls.push(['paste', text]);
    }),
    sendKey: vi.fn((keysym: number, code: string | null, down?: boolean) => {
      calls.push(['key', keysym, code, down]);
    }),
    emitClipboard: (text: string) => listener?.(new CustomEvent('clipboard', { detail: { text } })),
  } satisfies ClipboardRfb & Record<string, unknown>;
};

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

const blobText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const settled = (promise: Promise<unknown>) => {
  const state = { value: 'pending' as 'pending' | 'resolved' | 'rejected' };
  promise.then(
    () => {
      state.value = 'resolved';
    },
    () => {
      state.value = 'rejected';
    }
  );
  return state;
};

describe('attachComputerClipboard', () => {
  let target: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let rfb: ReturnType<typeof createRfb>;
  let clipboard: {
    readText: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeText: ReturnType<typeof vi.fn>;
  };
  let onPaste: ReturnType<typeof vi.fn>;
  let canvasKeys: ReturnType<typeof vi.fn>;
  let controlling: boolean;
  let detach: (() => void) | undefined;

  const attach = (options: Partial<ComputerClipboardOptions> = {}) => {
    detach = attachComputerClipboard(target, rfb, {
      isControlling: () => controlling,
      apple: false,
      readOnShortcut: false,
      clipboard,
      onPaste,
      ...options,
    });
  };

  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  };

  const paste = (text: string, on: Element = canvas) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    on.dispatchEvent(event);
    return event;
  };

  const writtenItem = (index = 0) => {
    const [items] = clipboard.write.mock.calls[index] as [FakeClipboardItem[]];
    return items[0].items['text/plain'];
  };

  beforeEach(() => {
    target = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    target.append(canvas);
    document.body.append(target);
    canvas.focus();
    canvasKeys = vi.fn();
    canvas.addEventListener('keydown', canvasKeys);
    canvas.addEventListener('keyup', canvasKeys);
    controlling = true;
    rfb = createRfb();
    clipboard = {
      readText: vi.fn(() => Promise.resolve('')),
      write: vi.fn(() => Promise.resolve()),
      writeText: vi.fn(() => Promise.resolve()),
    };
    onPaste = vi.fn();
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    target.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pastes the local text, then presses v under the held modifier', () => {
    attach();

    const shortcut = key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(shortcut.defaultPrevented).toBe(false);
    expect(canvasKeys).not.toHaveBeenCalled();

    const event = paste('hello');
    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(event.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenCalledWith('sent');
  });

  it('presses a held Ctrl again before v, without releasing it', () => {
    // noVNC on Windows holds a Ctrl press back up to 100 ms to detect AltGr.
    attach();

    key('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('hello');

    expect(rfb.calls.slice(1)).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(rfb.calls).not.toContainEqual(['key', CONTROL_L_KEYSYM, 'ControlLeft', false]);
  });

  it('sends V for a shifted paste', () => {
    attach();

    key('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', SHIFT_V_KEYSYM, 'KeyV', true],
      ['key', SHIFT_V_KEYSYM, 'KeyV', false],
    ]);
  });

  it('sends the whole Ctrl+V chord for a paste without the shortcut', () => {
    attach();

    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('sends the chord again once the modifier is up', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    key('keyup', { key: 'Control', code: 'ControlLeft' });
    paste('hello');

    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('still presses v for a paste without text', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('');

    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
    expect(onPaste).toHaveBeenCalledWith('sent');
  });

  it('takes a paste aimed outside the screen while the screen has focus', () => {
    const bodyPaste = vi.fn();
    document.body.addEventListener('paste', bodyPaste);
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    const event = paste('hello', document.body);

    expect(rfb.calls[0]).toEqual(['paste', 'hello']);
    expect(event.defaultPrevented).toBe(true);
    expect(bodyPaste).not.toHaveBeenCalled();
    document.body.removeEventListener('paste', bodyPaste);
  });

  it('ignores a paste while focus is outside the screen', () => {
    const input = document.createElement('input');
    document.body.append(input);
    attach();

    input.focus();
    const event = paste('hello', input);

    expect(rfb.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });

  it('refuses a paste over 512 KiB', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    paste('a'.repeat(MAX_PASTE_BYTES));
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenLastCalledWith('sent');

    rfb.clipboardPasteFrom.mockClear();
    rfb.sendKey.mockClear();
    // 524,290 UTF-8 bytes in 262,145 characters.
    const event = paste('é'.repeat(262_145));

    expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
    expect(rfb.sendKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenLastCalledWith('too-large');
  });

  it('leaves Alt+V and composing keydowns to noVNC', () => {
    attach();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, altKey: true });
    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, isComposing: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([]);
  });

  it('does nothing while watching', () => {
    controlling = false;
    attach({ apple: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    const event = paste('hello');

    expect(canvasKeys).toHaveBeenCalledTimes(3);
    expect(rfb.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('copies the next remote clipboard text for a copy gesture', async () => {
    attach();

    const event = key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledWith(event);
    expect(clipboard.write).toHaveBeenCalledTimes(1);

    rfb.emitClipboard('from remote');
    const blob = await writtenItem();

    expect(blob.type).toBe('text/plain');
    await expect(blobText(blob)).resolves.toBe('from remote');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('cuts the same way as copy', async () => {
    attach();

    const event = key('keydown', { key: 'x', code: 'KeyX', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledWith(event);
    expect(clipboard.write).toHaveBeenCalledTimes(1);

    rfb.emitClipboard('cut text');
    await expect(writtenItem().then(blobText)).resolves.toBe('cut text');
  });

  it('rejects a copy that gets no reply within 2 s', async () => {
    vi.useFakeTimers();
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    const state = settled(writtenItem());

    await vi.advanceTimersByTimeAsync(1_999);
    expect(state.value).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(state.value).toBe('rejected');
  });

  it('replaces a pending copy with a newer one', async () => {
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');

    await expect(writtenItem(0)).rejects.toBeInstanceOf(Error);
    await expect(writtenItem(1).then(blobText)).resolves.toBe('from remote');
  });

  it('ignores a remote clipboard push without a copy gesture', async () => {
    attach();

    rfb.emitClipboard('pushed by the server');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to writeText without ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(clipboard.write).not.toHaveBeenCalled();
    rfb.emitClipboard('from remote');
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('from remote'));
  });

  it('swallows a failed clipboard write', async () => {
    clipboard.write.mockImplementation(() => Promise.reject(new Error('denied')));
    clipboard.writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    attach();

    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');
    vi.stubGlobal('ClipboardItem', undefined);
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
    rfb.emitClipboard('from remote');

    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
  });

  it('maps Cmd to Ctrl on Apple, once per press', () => {
    attach({ apple: true });

    const press = key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    expect(rfb.calls).toEqual([['key', CONTROL_L_KEYSYM, 'ControlLeft', true]]);
    expect(press.defaultPrevented).toBe(true);
    expect(canvasKeys).not.toHaveBeenCalled();

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, repeat: true });
    expect(rfb.calls).toHaveLength(1);

    const shortcut = key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    expect(shortcut.defaultPrevented).toBe(false);
    expect(canvasKeys).not.toHaveBeenCalled();
    paste('hello');
    expect(rfb.calls.slice(1)).toEqual([
      ['paste', 'hello'],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);

    const release = key('keyup', { key: 'Meta', code: 'MetaLeft' });
    expect(release.defaultPrevented).toBe(true);
    expect(rfb.calls.at(-1)).toEqual(['key', CONTROL_L_KEYSYM, 'ControlLeft', false]);
    expect(canvasKeys).not.toHaveBeenCalled();

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    expect(canvasKeys).toHaveBeenCalledTimes(1);
  });

  const releases = (keysym: number) =>
    rfb.sendKey.mock.calls.filter(([sent, , down]) => sent === keysym && down === false).length;

  const pressCmdShift = () => {
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
  };

  it('releases a mapped Ctrl on window blur and on detach', () => {
    attach({ apple: true });

    pressCmdShift();
    window.dispatchEvent(new Event('blur'));
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);
    window.dispatchEvent(new Event('blur'));
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    pressCmdShift();
    detach?.();
    detach = undefined;
    expect(releases(CONTROL_L_KEYSYM)).toBe(2);
    expect(releases(SHIFT_L_KEYSYM)).toBe(2);
  });

  it('keeps Shift held under Cmd on Apple, so Cmd+Shift+Z is Ctrl+Shift+Z', () => {
    attach({ apple: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    const shift = key('keydown', {
      key: 'Shift',
      code: 'ShiftLeft',
      metaKey: true,
      shiftKey: true,
    });
    key('keydown', {
      key: 'Shift',
      code: 'ShiftLeft',
      metaKey: true,
      shiftKey: true,
      repeat: true,
    });
    const z = key('keydown', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true });

    expect(shift.defaultPrevented).toBe(true);
    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', SHIFT_L_KEYSYM, 'ShiftLeft', true],
    ]);
    expect(canvasKeys.mock.calls).toEqual([[z]]);
    expect(z.defaultPrevented).toBe(false);

    const release = key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });
    expect(release.defaultPrevented).toBe(true);
    expect(rfb.calls.at(-1)).toEqual(['key', SHIFT_L_KEYSYM, 'ShiftLeft', false]);
    expect(canvasKeys).toHaveBeenCalledTimes(1);
  });

  it('releases a mapped Shift with Cmd, once', () => {
    attach({ apple: true });

    pressCmdShift();
    key('keyup', { key: 'Meta', code: 'MetaLeft', shiftKey: true });
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    const shiftUp = key('keyup', { key: 'Shift', code: 'ShiftLeft' });
    expect(shiftUp.defaultPrevented).toBe(false);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);
  });

  it('leaves Shift pressed before Cmd to noVNC', () => {
    attach({ apple: true });

    key('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([['key', CONTROL_L_KEYSYM, 'ControlLeft', true]]);
  });

  it('releases the mapped keys when focus leaves the screen', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const focusOut = (relatedTarget: EventTarget | null) =>
      canvas.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
    attach({ apple: true });

    pressCmdShift();
    focusOut(target);
    expect(releases(CONTROL_L_KEYSYM)).toBe(0);

    focusOut(outside);
    expect(releases(CONTROL_L_KEYSYM)).toBe(1);
    expect(releases(SHIFT_L_KEYSYM)).toBe(1);

    pressCmdShift();
    focusOut(null);
    expect(releases(CONTROL_L_KEYSYM)).toBe(2);
    expect(releases(SHIFT_L_KEYSYM)).toBe(2);
    outside.remove();
  });

  it('leaves Meta and Shift alone off Apple', () => {
    attach();

    const press = key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });

    expect(press.defaultPrevented).toBe(false);
    expect(canvasKeys).toHaveBeenCalledTimes(5);
    expect(rfb.calls).toEqual([]);
  });

  it('reads the local clipboard on the shortcut where the engine fires no paste', async () => {
    clipboard.readText.mockResolvedValueOnce('hello');
    attach({ apple: true, readOnShortcut: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    const shortcut = key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(canvasKeys).not.toHaveBeenCalled();
    expect(clipboard.readText).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(onPaste).toHaveBeenCalledWith('sent'));
    expect(rfb.calls).toEqual([
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['paste', 'hello'],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
  });

  it('sends the chord when Cmd is up before the read resolves', async () => {
    let resolveRead: (text: string) => void = () => undefined;
    clipboard.readText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    );
    attach({ apple: true, readOnShortcut: true });

    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });
    rfb.calls.length = 0;
    resolveRead('hello');

    await vi.waitFor(() => expect(onPaste).toHaveBeenCalledWith('sent'));
    expect(rfb.calls).toEqual([
      ['paste', 'hello'],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', false],
    ]);
  });

  it('sends nothing when the clipboard read is refused', async () => {
    clipboard.readText.mockRejectedValueOnce(new Error('denied'));
    attach({ readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(rfb.calls).toEqual([]);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('leaves the shortcuts to noVNC without a clipboard API', () => {
    attach({ clipboard: undefined, readOnShortcut: true });

    key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true });
    key('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });

    expect(canvasKeys).toHaveBeenCalledTimes(2);
    expect(rfb.calls).toEqual([]);
  });

  it('detaches every listener', async () => {
    const listeners = [target, document, window].map((node) => ({
      added: vi.spyOn(node, 'addEventListener'),
      removed: vi.spyOn(node, 'removeEventListener'),
    }));
    attach({ apple: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    const pending = writtenItem();
    const [, clipboardListener] = rfb.addEventListener.mock.calls[0];

    detach?.();
    detach = undefined;
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(rfb.removeEventListener).toHaveBeenCalledWith('clipboard', clipboardListener);
    listeners.forEach(({ added, removed }) => {
      expect(added.mock.calls.length).toBeGreaterThan(0);
      expect(removed.mock.calls).toEqual(expect.arrayContaining(added.mock.calls));
    });

    rfb.calls.length = 0;
    clipboard.write.mockClear();
    canvasKeys.mockClear();
    key('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    key('keydown', { key: 'v', code: 'KeyV', metaKey: true });
    key('keydown', { key: 'c', code: 'KeyC', metaKey: true });
    key('keyup', { key: 'Meta', code: 'MetaLeft' });
    const event = paste('hello');
    window.dispatchEvent(new Event('blur'));

    expect(canvasKeys).toHaveBeenCalledTimes(4);
    expect(rfb.calls).toEqual([]);
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('isApplePlatform', () => {
  it.each([
    ['MacIntel', true],
    ['iPad', true],
    ['iPhone', true],
    ['Linux x86_64', false],
    ['Win32', false],
  ])('%s is %s', (platform, expected) => {
    expect(isApplePlatform(platform)).toBe(expected);
  });
});
