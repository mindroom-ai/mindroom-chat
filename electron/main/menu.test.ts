import { describe, expect, it, vi } from 'vitest';
import { buildContextMenu, buildMenuTemplate } from './menu';

const flattenItems = (
  items: Electron.MenuItemConstructorOptions[]
): Electron.MenuItemConstructorOptions[] =>
  items.flatMap((item) => {
    const sub = Array.isArray(item.submenu) ? flattenItems(item.submenu) : [];
    return [item, ...sub];
  });

const invokeClick = (item: Electron.MenuItemConstructorOptions | undefined): void => {
  item?.click?.({} as Electron.MenuItem, undefined, {});
};

const makeContextParams = (
  overrides: Partial<Electron.ContextMenuParams> = {}
): Electron.ContextMenuParams =>
  ({
    misspelledWord: '',
    dictionarySuggestions: [],
    isEditable: false,
    selectionText: '',
    linkURL: '',
    mediaType: 'none',
    srcURL: '',
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
    },
    ...overrides,
  }) as Electron.ContextMenuParams;

describe('buildMenuTemplate', () => {
  it('omits forbidden roles and New Window in every state combination across platforms', () => {
    const forbiddenRoles = new Set(['reload', 'forcereload', 'zoomin', 'zoomout', 'resetzoom']);
    const macOnlyRoles = new Set(['services', 'hide', 'hideothers', 'unhide', 'zoom', 'front']);
    for (const platform of ['darwin', 'linux'] as const) {
      const expectedTop =
        platform === 'darwin'
          ? ['MindRoom', 'Edit', 'View', 'Window', 'help']
          : ['File', 'Edit', 'View', 'Window', 'Help'];
      for (const updateReady of [false, true]) {
        for (const canCheck of [false, true]) {
          for (const quickCapture of [false, true]) {
            const template = buildMenuTemplate(
              { updateReady, canCheck, quickCapture },
              undefined,
              platform
            );
            expect(template.map((m) => m.label ?? m.role)).toEqual(expectedTop);
            for (const item of flattenItems(template)) {
              const role = String(item.role ?? '').toLowerCase();
              expect(forbiddenRoles.has(role)).toBe(false);
              expect(String(item.label ?? '').toLowerCase()).not.toBe('new window');
              if (platform !== 'darwin') {
                expect(macOnlyRoles.has(role)).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('wires View zoom items and accelerators to the zoom handler on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const onZoom = vi.fn();
      const template = buildMenuTemplate(
        { updateReady: false, canCheck: false, quickCapture: false },
        { onZoom },
        platform
      );
      const viewSub = template.find((m) => m.label === 'View')
        ?.submenu as Electron.MenuItemConstructorOptions[];
      const zoomIn = viewSub.find((i) => i.label === 'Zoom In');
      const zoomOut = viewSub.find((i) => i.label === 'Zoom Out');
      const actualSize = viewSub.find((i) => i.label === 'Actual Size');

      expect(zoomIn?.accelerator).toBe('CommandOrControl+Plus');
      expect(zoomOut?.accelerator).toBe('CommandOrControl+-');
      expect(actualSize?.accelerator).toBe('CommandOrControl+0');
      expect(viewSub.some((i) => i.role === 'togglefullscreen')).toBe(true);

      invokeClick(zoomIn);
      invokeClick(zoomOut);
      invokeClick(actualSize);
      expect(onZoom.mock.calls).toEqual([['in'], ['out'], ['reset']]);
    }
  });

  it('toggles update items in the macOS App menu and Quick Capture in the Window menu', () => {
    const onCheckForUpdates = vi.fn();
    const onRestartToUpdate = vi.fn();
    const onQuickCapture = vi.fn();

    const base = buildMenuTemplate(
      { updateReady: false, canCheck: false, quickCapture: false },
      undefined,
      'darwin'
    );
    const baseAppSub = base[0]?.submenu as Electron.MenuItemConstructorOptions[];
    const baseWinSub = base[3]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(baseAppSub.some((i) => i.label === 'Check for Updates...')).toBe(false);
    expect(baseAppSub.some((i) => i.label === 'Restart to Update')).toBe(false);
    expect(baseWinSub.some((i) => i.label === 'Quick Capture')).toBe(false);

    const checkable = buildMenuTemplate(
      { updateReady: false, canCheck: true, quickCapture: true },
      { onCheckForUpdates, onQuickCapture },
      'darwin'
    );
    const checkAppSub = checkable[0]?.submenu as Electron.MenuItemConstructorOptions[];
    const checkWinSub = checkable[3]?.submenu as Electron.MenuItemConstructorOptions[];
    const checkItem = checkAppSub.find((i) => i.label === 'Check for Updates...');
    const qcItem = checkWinSub.find((i) => i.label === 'Quick Capture');
    expect(checkItem).toBeDefined();
    expect(qcItem?.accelerator).toBe('Control+Alt+Space');
    invokeClick(checkItem);
    invokeClick(qcItem);
    expect(onCheckForUpdates).toHaveBeenCalledOnce();
    expect(onQuickCapture).toHaveBeenCalledOnce();

    const ready = buildMenuTemplate(
      { updateReady: true, canCheck: true, quickCapture: false },
      { onRestartToUpdate },
      'darwin'
    );
    const readyAppSub = ready[0]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(readyAppSub.some((i) => i.label === 'Check for Updates...')).toBe(false);
    const restartItem = readyAppSub.find((i) => i.label === 'Restart to Update');
    expect(restartItem).toBeDefined();
    invokeClick(restartItem);
    expect(onRestartToUpdate).toHaveBeenCalledOnce();
  });

  it('places update items in Help and omits macOS Window roles on Linux', () => {
    const onCheckForUpdates = vi.fn();
    const onRestartToUpdate = vi.fn();
    const onQuickCapture = vi.fn();

    const base = buildMenuTemplate(
      { updateReady: false, canCheck: false, quickCapture: false },
      undefined,
      'linux'
    );
    expect(base[0]?.submenu).toEqual([{ role: 'close' }, { type: 'separator' }, { role: 'quit' }]);
    expect(base[3]?.submenu).toEqual([{ role: 'minimize' }]);
    expect(base[4]?.submenu).toEqual([{ role: 'about' }]);

    const checkable = buildMenuTemplate(
      { updateReady: false, canCheck: true, quickCapture: true },
      { onCheckForUpdates, onQuickCapture },
      'linux'
    );
    const checkWinSub = checkable[3]?.submenu as Electron.MenuItemConstructorOptions[];
    const checkHelpSub = checkable[4]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(checkWinSub.map((i) => i.label ?? i.role ?? i.type)).toEqual([
      'Quick Capture',
      'separator',
      'minimize',
    ]);
    const qcItem = checkWinSub.find((i) => i.label === 'Quick Capture');
    const checkItem = checkHelpSub.find((i) => i.label === 'Check for Updates...');
    expect(qcItem?.accelerator).toBe('Control+Alt+Space');
    expect(checkItem).toBeDefined();
    expect(checkHelpSub.some((i) => i.role === 'about')).toBe(true);
    invokeClick(qcItem);
    invokeClick(checkItem);
    expect(onQuickCapture).toHaveBeenCalledOnce();
    expect(onCheckForUpdates).toHaveBeenCalledOnce();

    const ready = buildMenuTemplate(
      { updateReady: true, canCheck: true, quickCapture: false },
      { onRestartToUpdate },
      'linux'
    );
    const readyHelpSub = ready[4]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(readyHelpSub.some((i) => i.label === 'Check for Updates...')).toBe(false);
    const restartItem = readyHelpSub.find((i) => i.label === 'Restart to Update');
    expect(restartItem).toBeDefined();
    invokeClick(restartItem);
    expect(onRestartToUpdate).toHaveBeenCalledOnce();
  });

  it('contains no leading, trailing, or consecutive separators in any submenu', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      for (const state of [
        { updateReady: false, canCheck: false, quickCapture: false },
        { updateReady: false, canCheck: true, quickCapture: true },
        { updateReady: true, canCheck: true, quickCapture: true },
      ]) {
        for (const top of buildMenuTemplate(state, undefined, platform)) {
          const sub = (top.submenu as Electron.MenuItemConstructorOptions[]) ?? [];
          if (sub.length === 0) continue;
          expect(sub[0]?.type).not.toBe('separator');
          expect(sub[sub.length - 1]?.type).not.toBe('separator');
          for (let i = 1; i < sub.length; i += 1) {
            expect(sub[i - 1]?.type === 'separator' && sub[i]?.type === 'separator').toBe(false);
          }
        }
      }
    }
  });
});

describe('buildContextMenu', () => {
  it('returns an empty menu for plain non-editable, unselected content', () => {
    expect(buildContextMenu(makeContextParams())).toEqual([]);
    expect(buildContextMenu(makeContextParams({ selectionText: '   \n\t ' }))).toEqual([]);
  });

  it('omits spelling suggestions and Add to Dictionary when the target is not editable', () => {
    const items = buildContextMenu(
      makeContextParams({
        isEditable: false,
        misspelledWord: 'helo',
        dictionarySuggestions: ['hello', 'halo'],
      })
    );
    expect(items).toEqual([]);
  });

  it('builds spelling suggestions, Add to Dictionary, and edit roles for editable fields', () => {
    const replaceMisspelling = vi.fn();
    const addToDictionary = vi.fn();
    const items = buildContextMenu(
      makeContextParams({
        isEditable: true,
        misspelledWord: 'helo',
        dictionarySuggestions: ['hello', 'halo'],
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canDelete: true,
          canSelectAll: true,
          canEditRichly: false,
        },
      }),
      { replaceMisspelling, addToDictionary }
    );

    expect(items.map((i) => i.label ?? i.role ?? i.type)).toEqual([
      'hello',
      'halo',
      'separator',
      'Add to Dictionary',
      'separator',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'selectAll',
    ]);

    invokeClick(items[0]);
    expect(replaceMisspelling).toHaveBeenCalledWith('hello');
    invokeClick(items[3]);
    expect(addToDictionary).toHaveBeenCalledWith('helo');
    expect(items[5]?.enabled).toBe(true);
    expect(items[8]?.enabled).toBe(true);
  });

  it('offers Copy on selected non-editable text and Copy Link / Copy Image Address verbatim', () => {
    const writeClipboardText = vi.fn();
    const items = buildContextMenu(
      makeContextParams({
        selectionText: 'some text',
        linkURL: 'https://example.org/docs?a=1#b',
        mediaType: 'image',
        srcURL: 'https://matrix.example/_matrix/client/v1/media/download/example/abc',
      }),
      { writeClipboardText }
    );

    expect(items.map((i) => i.label ?? i.role ?? i.type)).toEqual([
      'copy',
      'separator',
      'Copy Link',
      'Copy Image Address',
    ]);

    invokeClick(items[2]);
    invokeClick(items[3]);
    expect(writeClipboardText.mock.calls).toEqual([
      ['https://example.org/docs?a=1#b'],
      ['https://matrix.example/_matrix/client/v1/media/download/example/abc'],
    ]);
  });

  it('does not add Copy Image Address for non-image media or missing srcURL', () => {
    const items = buildContextMenu(
      makeContextParams({
        mediaType: 'video',
        srcURL: 'https://example.org/video.mp4',
      })
    );
    expect(items).toEqual([]);

    const linkOnly = buildContextMenu(
      makeContextParams({
        linkURL: 'https://example.org',
        mediaType: 'image',
        srcURL: '',
      })
    );
    expect(linkOnly.map((i) => i.label)).toEqual(['Copy Link']);
  });
});
