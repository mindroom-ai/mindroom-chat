// @vitest-environment jsdom

import React from 'react';
import type FocusTrap from 'focus-trap-react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_SETTINGS_EVENT } from '../../../matrix/protocol/roomSettings';
import type { ModelCatalogEntry } from '../../../models/modelProtocol';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { ScreenSize, ScreenSizeProvider } from '../../../lib/hooks/useScreenSize';
import { ROOM_SETTING_SECTIONS, type RoomModelSettingDefinition } from './roomSettingDefinitions';
import { RoomModelSettingTile } from './RoomModelSettingTile';

const ROOM = { roomId: '!room:example.test' } as Room;
const ALL_SETTINGS = ROOM_SETTING_SECTIONS.flatMap((section) => section.settings);
const MODEL_DEF = ALL_SETTINGS.find((d): d is RoomModelSettingDefinition => d.key === 'model')!;
const TITLE_MODEL_DEF = ALL_SETTINGS.find(
  (d): d is RoomModelSettingDefinition => d.key === 'thread_summary_model'
)!;
const FAILED = "Couldn't save the setting. Try again.";
const READ_ONLY = "Only people allowed to change this room's settings can edit this.";

const MODELS: ModelCatalogEntry[] = [
  { key: 'fast', display_name: 'Quick', provider: 'acme', id: 'acme-fast-1' },
  {
    key: 'deep',
    display_name: 'Deep',
    provider: 'acme',
    id: 'acme-deep-2',
    reasoning_levels: ['low', 'medium', 'high'],
    reasoning_default: 'medium',
  },
];

const RUNTIME = {
  id: '@mindroom_router:example.test:DEV1',
  userId: '@mindroom_router:example.test',
  deviceId: 'DEV1',
  curveKey: 'curve-1',
};

const live = vi.hoisted(() => ({
  event: undefined as MatrixEvent | undefined,
  canSend: true,
  stateArgs: [] as unknown[],
}));

const client = vi.hoisted(() => ({
  getSafeUserId: () => '@editor:example.test',
  sendStateEvent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
// jsdom lays nothing out, so every element counts as shown for the trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealFocusTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealFocusTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});
vi.mock('../../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => live.canSend }),
}));
vi.mock('../../../matrix/hooks/useStateEvent', () => ({
  useStateEvent: (...args: unknown[]) => {
    live.stateArgs = args;
    return live.event;
  },
}));
let eventCount = 0;
const setLive = (content: object | undefined, id = `$event${(eventCount += 1)}`) => {
  live.event =
    content === undefined
      ? undefined
      : ({ getId: () => id, getContent: () => content } as unknown as MatrixEvent);
};

const createCatalog = (overrides: Partial<ModelPickerState> = {}): ModelPickerState => ({
  eligible: true,
  runtimes: [RUNTIME],
  runtime: RUNTIME,
  models: MODELS,
  override: null,
  reasoning: null,
  inherited: [],
  loading: false,
  pending: false,
  // The runtime answered the latest refresh.
  canMutate: true,
  refresh: vi.fn(),
  chooseRuntime: vi.fn(),
  selectModel: vi.fn(),
  resetToRoomDefault: vi.fn(),
  ...overrides,
});
/** No runtime has answered. */
const NO_CATALOG = {
  eligible: false,
  runtimes: [],
  runtime: undefined,
  models: [],
  canMutate: false,
};

const tile = (definition: RoomModelSettingDefinition, catalog: ModelPickerState) => (
  <ScreenSizeProvider value={ScreenSize.Desktop}>
    <RoomModelSettingTile room={ROOM} definition={definition} catalog={catalog} />
  </ScreenSizeProvider>
);
const renderTile = (
  definition: RoomModelSettingDefinition = MODEL_DEF,
  catalog: ModelPickerState = createCatalog()
) => render(tile(definition, catalog));

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
/** Opens the menu as Enter on the focused button does. */
const open = (name = 'Model') => {
  act(() => trigger().focus());
  fireEvent.click(trigger());
  return screen.getByRole('dialog', { name });
};
const defaultRow = () => screen.getByRole('option', { name: /Use configured default/ });
const sent = (content: object, key = 'model') => [ROOM.roomId, ROOM_SETTINGS_EVENT, content, key];
/** The closing menu's trap hands focus back in a timer. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve)));

beforeEach(() => {
  live.event = undefined;
  live.canSend = true;
  client.sendStateEvent.mockReset();
  client.sendStateEvent.mockImplementation(async () => ({
    event_id: `$sent${client.sendStateEvent.mock.calls.length - 1}`,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RoomModelSettingTile', () => {
  it('shows Use configured default when unset, and opens on its row with the list asked again', () => {
    const catalog = createCatalog();
    renderTile(MODEL_DEF, catalog);
    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'model']);
    expect(trigger().textContent).toBe('Use configured default');

    const dialog = open();
    expect(catalog.refresh).toHaveBeenCalledTimes(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(defaultRow().getAttribute('aria-selected')).toBe('true');
  });

  it('writes the picked model through the room setting, never the thread picker', async () => {
    const catalog = createCatalog();
    renderTile(MODEL_DEF, catalog);

    open();
    fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({ value: 'deep' }));
    expect(catalog.selectModel).not.toHaveBeenCalled();
    expect(catalog.resetToRoomDefault).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger().textContent).toBe('Deep');
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('writes key@level from the effort column on Model and offers no levels on Title model', async () => {
    setLive({ value: 'deep@high' });
    renderTile();
    expect(trigger().textContent).toBe('Deep · High');

    open();
    const effort = screen.getByRole('radiogroup', { name: 'Effort for Deep' });
    expect(within(effort).getByRole('radio', { name: 'High' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    fireEvent.click(within(effort).getByRole('radio', { name: 'Low' }));
    await settle();
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(...sent({ value: 'deep@low' }));
    expect(trigger().textContent).toBe('Deep · Low');

    cleanup();
    setLive({ value: 'deep' });
    renderTile(TITLE_MODEL_DEF);
    open('Title model');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Quick/ }));
    await settle();
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ...sent({ value: 'fast' }, 'thread_summary_model')
    );
  });

  it('shows a value the list does not know as it is, never as the default, and resets it', async () => {
    setLive({ value: 'retired-model' });
    renderTile();
    expect(trigger().textContent).toBe('retired-model');
    expect(
      screen.getByText('Unknown model: "retired-model" is not in this room\'s model list.')
    ).toBeTruthy();

    open();
    expect(defaultRow().getAttribute('aria-selected')).toBe('false');
    fireEvent.click(defaultRow());
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({}));
    expect(trigger().textContent).toBe('Use configured default');
  });

  it('marks a level its model does not have as unknown', () => {
    setLive({ value: 'deep@bogus' });
    renderTile();
    expect(trigger().textContent).toBe('deep@bogus');
    expect(
      screen.getByText('Unknown model: "deep@bogus" is not in this room\'s model list.')
    ).toBeTruthy();
  });

  it('without a list shows the stored value, a notice with Retry, and still resets', async () => {
    setLive({ value: 'saved-model' });
    const catalog = createCatalog(NO_CATALOG);
    renderTile(MODEL_DEF, catalog);
    expect(trigger().textContent).toBe('saved-model');
    expect(screen.getByText('Room setting: saved-model')).toBeTruthy();
    expect(screen.queryByText(/Unknown model:/)).toBeNull();

    const dialog = open();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(
      'No model list is available right now. You can still reset to the configured default.Retry'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(catalog.refresh).toHaveBeenCalledTimes(2);
    expect(defaultRow().getAttribute('aria-selected')).toBe('false');

    fireEvent.click(defaultRow());
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({}));
    expect(trigger().textContent).toBe('Use configured default');
  });

  it('keeps the menu, its focus and the reset row while the list loads and when it arrives', async () => {
    const { rerender } = renderTile(MODEL_DEF, createCatalog({ ...NO_CATALOG, loading: true }));

    const dialog = open();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole('status').textContent).toBe('Loading models');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(defaultRow().getAttribute('aria-selected')).toBe('true');

    rerender(tile(MODEL_DEF, createCatalog()));
    expect(screen.getByRole('dialog', { name: 'Model' })).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getByRole('option', { name: /Deep/ }));
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({ value: 'deep' }));
  });

  it('resets at once while two runtimes answer and none is chosen', async () => {
    setLive({ value: 'deep' });
    const runtimes = [RUNTIME, { ...RUNTIME, id: `${RUNTIME.userId}:DEV2`, deviceId: 'DEV2' }];
    const catalog = createCatalog({ ...NO_CATALOG, runtimes, loading: true });
    renderTile(MODEL_DEF, catalog);

    open();
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeTruthy();
    fireEvent.click(defaultRow());
    await settle();
    expect(catalog.chooseRuntime).not.toHaveBeenCalled();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({}));
  });

  it('shows the rows it had while the list is asked again, and writes them once it answers', async () => {
    setLive({ value: 'deep' });
    const refresh = vi.fn();
    const { rerender } = renderTile(MODEL_DEF, createCatalog({ refresh }));

    const dialog = open();
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(tile(MODEL_DEF, createCatalog({ refresh, loading: true, canMutate: false })));
    expect(within(dialog).getByRole('status').textContent).toBe('Loading models');
    // The runtime may have lost a model of the list it had: no row of it writes yet.
    const quick = screen.getByRole('option', { name: /Quick/ });
    expect(quick.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(quick);
    fireEvent.click(screen.getByRole('radio', { name: 'Low' }));
    expect(client.sendStateEvent).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Model' })).toBe(dialog);
    expect(defaultRow().getAttribute('aria-disabled')).toBe('false');

    // Its answer came, with the window for other runtimes still open.
    rerender(tile(MODEL_DEF, createCatalog({ refresh, loading: true })));
    fireEvent.click(screen.getByRole('option', { name: /Quick/ }));
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({ value: 'fast' }));
  });

  it('resets while the list is asked again', async () => {
    setLive({ value: 'deep' });
    renderTile(MODEL_DEF, createCatalog({ loading: true, canMutate: false }));

    open();
    fireEvent.click(defaultRow());
    await settle();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({}));
  });

  it('trusts no list after a refresh that failed: the stored value shows as it is, with Retry', () => {
    setLive({ value: 'fast' });
    const refresh = vi.fn();
    const { rerender } = renderTile(MODEL_DEF, createCatalog({ refresh }));
    expect(trigger().textContent).toBe('Quick');

    // A refresh refused for want of capacity hides no list and confirms none: its rows show,
    // and write nothing.
    const busy = { refresh, error: 'Model discovery is busy.', canMutate: false };
    rerender(tile(MODEL_DEF, createCatalog(busy)));
    expect(trigger().textContent).toBe('Quick');
    open();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(
      'Loading models'
    );
    const deep = screen.getByRole('option', { name: /Deep/ });
    expect(deep.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(deep);
    expect(client.sendStateEvent).not.toHaveBeenCalled();
    expect(defaultRow().getAttribute('aria-disabled')).toBe('false');

    // No runtime answered a refresh, so the catalog holds no list any more.
    rerender(tile(MODEL_DEF, createCatalog({ ...NO_CATALOG, refresh })));
    expect(trigger().textContent).toBe('fast');
    expect(screen.getByText('Room setting: fast')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Deep/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'No model list is available right now. You can still reset to the configured default.Retry'
    );
    expect(defaultRow().getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps focus on its button through a save, which opens nothing meanwhile', async () => {
    let finish: (result: { event_id: string }) => void = () => undefined;
    client.sendStateEvent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    renderTile();

    open();
    fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().disabled).toBe(false);
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => finish({ event_id: '$sent' }));
    expect(document.activeElement).toBe(trigger());
    expect(trigger().hasAttribute('aria-disabled')).toBe(false);
    expect(trigger().textContent).toBe('Deep');
  });

  it('shows an alert when the save fails, and a disabled button to someone who may not edit', async () => {
    setLive({ value: 'fast' });
    client.sendStateEvent.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    renderTile();

    open();
    fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(trigger().textContent).toBe('Quick');

    cleanup();
    live.canSend = false;
    renderTile();
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toBe('Quick');
    expect(screen.getByText(READ_ONLY)).toBeTruthy();
  });

  it('closes its menu when the right to edit goes, and moves the keys to the line that says why', async () => {
    const loading = createCatalog({ ...NO_CATALOG, loading: true });
    const { rerender } = renderTile(MODEL_DEF, loading);
    open();

    live.canSend = false;
    rerender(tile(MODEL_DEF, loading));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger().disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByText(READ_ONLY));

    // Allowed again, the menu stays closed until asked for.
    live.canSend = true;
    rerender(tile(MODEL_DEF, loading));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('places the menu again when the list that arrives makes it taller', () => {
    // Near the bottom edge the short menu fits under the button and the full one does not.
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }

        observe = () => undefined;

        disconnect = () => undefined;
      }
    );
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
    let height = 60;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
      this: HTMLElement
    ) {
      return this === trigger() ? new DOMRect(600, 500, 150, 30) : new DOMRect(0, 0, 240, height);
    });
    const { rerender } = renderTile(MODEL_DEF, createCatalog({ ...NO_CATALOG, loading: true }));
    const dialog = open();
    const placed = dialog.parentElement!.parentElement!;
    expect(placed.style.top).toBe('535px');
    expect(placed.style.bottom).not.toBe('70px');

    height = 344;
    rerender(tile(MODEL_DEF, createCatalog()));
    act(() => resized.forEach((callback) => callback()));
    // Beside the button now, their bottom edges level, so every row is on screen.
    expect(placed.style.bottom).toBe('70px');
    expect(screen.getByRole('dialog', { name: 'Model' })).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
