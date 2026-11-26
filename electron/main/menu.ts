export type MenuState = {
  updateReady: boolean;
  canCheck: boolean;
  quickCapture: boolean;
};

export type MenuHandlers = {
  onZoom?: (action: 'in' | 'out' | 'reset') => void;
  onCheckForUpdates?: () => void;
  onRestartToUpdate?: () => void;
  onQuickCapture?: () => void;
};

export type ContextMenuActions = {
  replaceMisspelling?: (suggestion: string) => void;
  addToDictionary?: (word: string) => void;
  writeClipboardText?: (text: string) => void;
};

const cleanSeparators = (
  items: Electron.MenuItemConstructorOptions[]
): Electron.MenuItemConstructorOptions[] => {
  const result: Electron.MenuItemConstructorOptions[] = [];
  for (const item of items) {
    if (item.type === 'separator') {
      const prev = result[result.length - 1];
      if (!prev || prev.type === 'separator') continue;
    }
    result.push(item);
  }
  while (result.length > 0 && result[result.length - 1]?.type === 'separator') {
    result.pop();
  }
  return result;
};

export const buildMenuTemplate = (
  state: MenuState,
  handlers?: MenuHandlers,
  platform: NodeJS.Platform = process.platform
): Electron.MenuItemConstructorOptions[] => {
  const updateItems: Electron.MenuItemConstructorOptions[] = state.updateReady
    ? [{ label: 'Restart to Update', click: () => handlers?.onRestartToUpdate?.() }]
    : state.canCheck
      ? [{ label: 'Check for Updates...', click: () => handlers?.onCheckForUpdates?.() }]
      : [];

  const quickCaptureItems: Electron.MenuItemConstructorOptions[] = state.quickCapture
    ? [
        {
          label: 'Quick Capture',
          accelerator: 'Control+Alt+Space',
          click: () => handlers?.onQuickCapture?.(),
        },
        { type: 'separator' },
      ]
    : [];

  const editMenu: Electron.MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Zoom In',
        accelerator: 'CommandOrControl+Plus',
        click: () => handlers?.onZoom?.('in'),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        click: () => handlers?.onZoom?.('out'),
      },
      {
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        click: () => handlers?.onZoom?.('reset'),
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  if (platform === 'darwin') {
    const appSubmenu: Electron.MenuItemConstructorOptions[] = [
      { role: 'about' },
      { type: 'separator' },
      ...updateItems,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ];
    const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
      ...quickCaptureItems,
      { role: 'minimize' },
      { role: 'zoom' },
      { role: 'close' },
      { type: 'separator' },
      { role: 'front' },
    ];
    return [
      { label: 'MindRoom', submenu: cleanSeparators(appSubmenu) },
      editMenu,
      viewMenu,
      { label: 'Window', submenu: cleanSeparators(windowSubmenu) },
      { role: 'help', submenu: [] },
    ];
  }

  return [
    { label: 'File', submenu: [{ role: 'close' }, { type: 'separator' }, { role: 'quit' }] },
    editMenu,
    viewMenu,
    {
      label: 'Window',
      submenu: cleanSeparators([...quickCaptureItems, { role: 'minimize' }]),
    },
    {
      label: 'Help',
      submenu: cleanSeparators([...updateItems, { type: 'separator' }, { role: 'about' }]),
    },
  ];
};

export const buildContextMenu = (
  params: Electron.ContextMenuParams,
  actions?: ContextMenuActions
): Electron.MenuItemConstructorOptions[] => {
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (params.isEditable && params.misspelledWord && params.dictionarySuggestions.length > 0) {
    for (const suggestion of params.dictionarySuggestions) {
      items.push({
        label: suggestion,
        click: () => actions?.replaceMisspelling?.(suggestion),
      });
    }
    items.push({ type: 'separator' });
  }

  if (params.isEditable && params.misspelledWord) {
    items.push(
      {
        label: 'Add to Dictionary',
        click: () => actions?.addToDictionary?.(params.misspelledWord),
      },
      { type: 'separator' }
    );
  }

  if (params.isEditable) {
    items.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    );
  } else if (params.selectionText.trim().length > 0) {
    items.push({ role: 'copy' });
  }

  const copyItems: Electron.MenuItemConstructorOptions[] = [];
  if (params.linkURL) {
    copyItems.push({
      label: 'Copy Link',
      click: () => actions?.writeClipboardText?.(params.linkURL),
    });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    copyItems.push({
      label: 'Copy Image Address',
      click: () => actions?.writeClipboardText?.(params.srcURL),
    });
  }
  if (copyItems.length > 0) {
    items.push({ type: 'separator' }, ...copyItems);
  }

  return cleanSeparators(items);
};
