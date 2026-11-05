// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOverlayFocus, layerOf } from './overlayFocus';

const flush = async () => {
  // Mutation observers run as microtasks; the manager then waits one timeout.
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1);
};

const button = (label: string): HTMLButtonElement => {
  const element = document.createElement('button');
  element.textContent = label;
  return element;
};

/** A portaled menu with two items, like a folds PopOut in `<body>`. */
const menuLayer = (): { layer: HTMLDivElement; first: HTMLButtonElement } => {
  const layer = document.createElement('div');
  const first = button('First item');
  layer.append(first, button('Second item'));
  return { layer, first };
};

const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('overlay focus', () => {
  let uninstall: () => void;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom lays nothing out; every connected element counts as shown.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
      this: HTMLElement
    ) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    document.body.innerHTML = '<div id="root"></div><div id="portalContainer"></div>';
    trigger = button('Options');
    document.getElementById('root')!.append(trigger);
    uninstall = installOverlayFocus(document);
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('finds the portaled layer of a node, and none for the app', () => {
    const { layer, first } = menuLayer();
    document.getElementById('portalContainer')!.append(layer);
    expect(layerOf(document, first)).toBe(layer);
    expect(layerOf(document, trigger)).toBeUndefined();
  });

  it('moves focus into a menu that Enter opened while focus stayed on its button', async () => {
    trigger.focus();
    press(trigger, 'Enter');
    const { layer, first } = menuLayer();
    document.body.append(layer);
    await flush();
    expect(document.activeElement).toBe(first);
  });

  it('leaves focus alone when a pointer opened the menu', async () => {
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const { layer } = menuLayer();
    document.body.append(layer);
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not take focus for a tooltip', async () => {
    trigger.focus();
    press(trigger, 'Enter');
    const layer = document.createElement('div');
    layer.innerHTML = '<div role="tooltip"><a href="#x">Link</a></div>';
    document.body.append(layer);
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it('gives focus back to the opener when Escape closes the menu', async () => {
    trigger.focus();
    press(trigger, 'Enter');
    const { layer, first } = menuLayer();
    document.body.append(layer);
    await flush();
    expect(document.activeElement).toBe(first);

    press(first, 'Escape');
    layer.remove();
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it('remembers an opener that Tab left for a menu, and returns to it after Enter on an item', async () => {
    trigger.focus();
    const { layer, first } = menuLayer();
    document.body.append(layer);
    await flush();
    first.focus();
    press(first, 'Enter');
    layer.remove();
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the focus a click gave elsewhere', async () => {
    trigger.focus();
    press(trigger, 'Enter');
    const { layer } = menuLayer();
    document.body.append(layer);
    await flush();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    layer.remove();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not move focus that the closing layer already handed on', async () => {
    const other = button('Other');
    document.getElementById('root')!.append(other);
    trigger.focus();
    press(trigger, 'Enter');
    const { layer } = menuLayer();
    document.body.append(layer);
    await flush();
    press(document.activeElement!, 'Escape');
    other.focus();
    layer.remove();
    await flush();
    expect(document.activeElement).toBe(other);
  });

  it('falls back to the outer menu item opener when a submenu and its menu close together', async () => {
    trigger.focus();
    press(trigger, 'Enter');
    const outer = menuLayer();
    document.body.append(outer.layer);
    await flush();
    press(outer.first, 'Enter');
    const inner = menuLayer();
    document.body.append(inner.layer);
    await flush();
    expect(document.activeElement).toBe(inner.first);

    press(inner.first, 'Enter');
    outer.layer.remove();
    inner.layer.remove();
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ['focus left on <body>', false],
    ['focus already back on the button', true],
  ])(
    'moves focus into a dialog that a menu item opened as its menu closed, with %s',
    async (_case, menuGaveFocusBack) => {
      trigger.focus();
      press(trigger, 'Enter');
      const menu = menuLayer();
      document.body.append(menu.layer);
      await flush();
      expect(document.activeElement).toBe(menu.first);

      // Enter on the item: the menu goes and the dialog comes in one render.
      press(menu.first, 'Enter');
      menu.layer.remove();
      if (menuGaveFocusBack) trigger.focus();
      const dialog = document.createElement('div');
      const close = button('Close');
      dialog.append(close);
      document.body.append(dialog);
      await flush();
      expect(document.activeElement).toBe(close);

      press(close, 'Escape');
      dialog.remove();
      await flush();
      expect(document.activeElement).toBe(trigger);
    }
  );

  it('never takes a control of a popover for the opener of the dialog it opened from', async () => {
    // A dialog whose opener is gone, with a "+ tag" button that opens a picker popover.
    const dialog = document.createElement('div');
    dialog.tabIndex = -1;
    const addTag = button('Add tag');
    dialog.append(addTag);
    document.body.append(dialog);
    addTag.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    addTag.focus();
    const picker = document.createElement('div');
    const field = document.createElement('input');
    picker.append(field);
    document.body.append(picker);
    await flush();
    field.focus();

    // Enter adds the tag: the button turns disabled while it saves, and the dialog's focus trap
    // takes focus back from the closing picker.
    press(field, 'Enter');
    addTag.disabled = true;
    dialog.focus();
    dialog.blur();
    picker.remove();
    await flush();

    expect(document.activeElement).toBe(document.body);
    dialog.remove();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  describe('dialogs', () => {
    /** A portaled dialog with a close button and a field, like the small prompts. */
    const dialogLayer = (role: 'dialog' | 'alertdialog', modal = true) => {
      const layer = document.createElement('div');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', role);
      if (modal) dialog.setAttribute('aria-modal', 'true');
      const close = button('Close');
      const field = document.createElement('input');
      dialog.append(close, field);
      layer.append(dialog);
      return { layer, dialog, close, field };
    };

    // Safari does not focus a button it clicks, so focus stays on <body>.
    const click = (target: Element, pointerType = 'mouse') => {
      const down = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerType', { value: pointerType });
      target.dispatchEvent(down);
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    };

    it('takes focus on its first control when a click opened it, and gives it back on close', async () => {
      click(trigger);
      const { layer, close } = dialogLayer('dialog');
      document.body.append(layer);
      await flush();
      expect(document.activeElement).toBe(close);

      // Closed with the pointer: its Close button is gone, focus fell to <body>.
      click(close);
      layer.remove();
      await flush();
      expect(document.activeElement).toBe(trigger);
    });

    it('focuses an alert dialog itself, so its question is read and Enter confirms nothing', async () => {
      click(trigger);
      const { layer, dialog } = dialogLayer('alertdialog');
      document.body.append(layer);
      await flush();
      expect(document.activeElement).toBe(dialog);
      expect(dialog.tabIndex).toBe(-1);
    });

    it('focuses the dialog itself when a tap opened it and its first control is a text field', async () => {
      click(trigger, 'touch');
      const { layer, dialog, close } = dialogLayer('dialog');
      close.remove();
      document.body.append(layer);
      await flush();
      expect(document.activeElement).toBe(dialog);
    });

    it('leaves focus alone for a dialog nobody opened, unless it is modal', async () => {
      const field = document.createElement('input');
      document.getElementById('root')!.append(field);
      field.focus();
      const popover = dialogLayer('alertdialog', false);
      document.body.append(popover.layer);
      await flush();
      expect(document.activeElement).toBe(field);

      const modal = dialogLayer('dialog');
      document.body.append(modal.layer);
      await flush();
      expect(document.activeElement).toBe(modal.close);
    });

    it('gives focus to the menu button after a dialog that a menu item opened as its menu closed', async () => {
      click(trigger);
      const menu = menuLayer();
      document.body.append(menu.layer);
      await flush();

      // The item opens the dialog and closes the menu in one render.
      click(menu.first);
      menu.layer.remove();
      const { layer, close } = dialogLayer('dialog');
      document.body.append(layer);
      await flush();
      expect(document.activeElement).toBe(close);

      press(close, 'Escape');
      layer.remove();
      await flush();
      expect(document.activeElement).toBe(trigger);
    });

    it.each([
      ['Tab', false],
      ['Shift+Tab', true],
    ] as const)('wraps focus around when %s would leave the dialog', async (_key, shiftKey) => {
      click(trigger);
      const opened = dialogLayer('dialog');
      document.body.append(opened.layer);
      await flush();
      const from = shiftKey ? opened.close : opened.field;
      from.focus();
      // Safari's Option+Tab past a focus scope: focus leaves the page.
      from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      from.blur();
      await flush();
      expect(document.activeElement).toBe(shiftKey ? opened.field : opened.close);
    });
  });
});
