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
  canMutate: false,
  refresh: vi.fn(),
  chooseRuntime: vi.fn(),
  selectModel: vi.fn(),
  resetToRoomDefault: vi.fn(),
  ...overrides,
});
/** No runtime has answered. */
const NO_CATALOG = { eligible: false, runtimes: [], runtime: undefined, models: [] };

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
    const catalog = createCatalog({ runtimes, runtime: undefined, models: [], loading: true });
    renderTile(MODEL_DEF, catalog);

    open();
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeTruthy();
    fireEvent.click(defaultRow());
    await settle();
    expect(catalog.chooseRuntime).not.toHaveBeenCalled();
    expect(client.sendStateEvent).toHaveBeenCalledWith(...sent({}));
  });

  it('keeps its rows while a list that answered is asked again, and drops them when that fails', () => {
    const refresh = vi.fn();
    const { rerender } = renderTile(MODEL_DEF, createCatalog({ refresh }));

    const dialog = open();
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(tile(MODEL_DEF, createCatalog({ refresh, loading: true })));
    expect(within(dialog).getByRole('status').textContent).toBe('Loading models');
    expect(screen.getByRole('option', { name: /Deep/ })).toBeTruthy();
    expect(defaultRow()).toBeTruthy();

    // The runtime did not answer: its old rows may name models it no longer has.
    rerender(tile(MODEL_DEF, createCatalog({ refresh, error: 'Model discovery unavailable.' })));
    expect(screen.queryByRole('option', { name: /Deep/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'No model list is available right now. You can still reset to the configured default.Retry'
    );
    expect(defaultRow()).toBeTruthy();
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

  it('keeps the keys in the open menu when the right to edit goes while the list loads', () => {
    const loading = createCatalog({ ...NO_CATALOG, loading: true });
    const { rerender } = renderTile(MODEL_DEF, loading);
    const dialog = open();

    live.canSend = false;
    rerender(tile(MODEL_DEF, loading));
    expect(defaultRow().getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(defaultRow());
    expect(client.sendStateEvent).not.toHaveBeenCalled();
  });
});
