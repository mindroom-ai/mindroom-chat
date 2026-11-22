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
vi.mock('focus-trap-react', async (original) => {
  const { default: RealFocusTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealFocusTrap
        {...props}
        focusTrapOptions={{
          ...focusTrapOptions,
          delayInitialFocus: false,
          tabbableOptions: { displayCheck: 'none' },
        }}
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
vi.mock('../../../models/ModelIcon', () => ({
  ModelIcon: ({ provider, id }: { provider?: string; id?: string }) => (
    <span data-testid="model-icon" data-provider={provider} data-id={id} />
  ),
}));
vi.mock('../../../ui/directional', () => ({
  PopOut: ({ anchor, content }: { anchor?: unknown; content?: React.ReactNode }) =>
    anchor ? <div data-testid="popout">{content}</div> : null,
}));
vi.mock('../../../ui/glass/GlassPrimitives', () => ({
  IconButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Menu: ({
    children,
    role,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    role?: string;
    'aria-label'?: string;
  }) => (
    <div role={role} aria-label={ariaLabel}>
      {children}
    </div>
  ),
}));
vi.mock('../../../ui/styles/Glass.css', () => ({ glassExpanded: 'glassExpanded' }));
vi.mock('../../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) => (
    <>{children(() => undefined)}</>
  ),
}));
vi.mock('../../../models/ModelPicker.css', () => ({
  Check: 'Check',
  Controls: 'Controls',
  EffortBack: 'EffortBack',
  EffortColumn: 'EffortColumn',
  EffortDefault: 'EffortDefault',
  EffortEntry: 'EffortEntry',
  EffortEntryBar: 'EffortEntryBar',
  EffortHeader: 'EffortHeader',
  EffortLabel: 'EffortLabel',
  EffortLevels: 'EffortLevels',
  EffortModel: 'EffortModel',
  EffortNone: 'EffortNone',
  EffortPanel: 'EffortPanel',
  EffortRow: 'EffortRow',
  EffortValue: 'EffortValue',
  Empty: 'Empty',
  Error: 'Error',
  ErrorActions: 'ErrorActions',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  IconImage: 'IconImage',
  Mirrored: 'Mirrored',
  Option: 'Option',
  OptionDetail: 'OptionDetail',
  OptionIcon: 'OptionIcon',
  OptionText: 'OptionText',
  OptionTitle: 'OptionTitle',
  Panel: 'Panel',
  Picker: 'Picker',
  Results: 'Results',
  RoomDefaultDetail: 'RoomDefaultDetail',
  RuntimeLabel: 'RuntimeLabel',
  RuntimeRow: 'RuntimeRow',
  RuntimeSelect: 'RuntimeSelect',
  SearchIcon: 'SearchIcon',
  SearchInput: 'SearchInput',
  SearchRow: 'SearchRow',
  StatusRow: 'StatusRow',
  TextButton: 'TextButton',
  Trigger: 'Trigger',
  TriggerDivider: 'TriggerDivider',
  ViewStatus: 'ViewStatus',
  VisuallyHidden: 'VisuallyHidden',
}));
vi.mock('./RoomModelSettingTile.css', () => ({ TriggerButton: 'TriggerButton' }));
vi.mock('./RoomTextSettingTile.css', () => ({ VisuallyHidden: 'VisuallyHidden' }));
vi.mock('folds', () => ({
  Box: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
  Button: React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      before?: React.ReactNode;
      after?: React.ReactNode;
      disabled?: boolean;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
      'aria-description'?: string;
      'aria-haspopup'?: React.AriaAttributes['aria-haspopup'];
      'aria-expanded'?: boolean;
    }
  >(function MockButton(
    {
      children,
      before,
      after,
      disabled,
      onClick,
      'aria-description': ariaDescription,
      'aria-haspopup': ariaHaspopup,
      'aria-expanded': ariaExpanded,
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-description={ariaDescription}
        aria-haspopup={ariaHaspopup}
        aria-expanded={ariaExpanded}
      >
        {before}
        {children}
        {after}
      </button>
    );
  }),
  Icon: () => null,
  Icons: { ChevronBottom: 'ChevronBottom' },
  Scroll: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(function MockScroll(
    { children },
    ref
  ) {
    return <div ref={ref}>{children}</div>;
  }),
  Spinner: () => <span data-testid="spinner" />,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  color: { Critical: { Main: 'red' } },
  config: { space: { S200: '8px', S300: '12px' } },
  toRem: (px: number) => `${px / 16}rem`,
}));
vi.mock('../../../ui/SettingTile', () => ({
  SettingTile: ({ title, after }: { title: string; after: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      {after}
    </div>
  ),
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

const renderTile = (
  definition: RoomModelSettingDefinition = MODEL_DEF,
  catalog: ModelPickerState = createCatalog()
) =>
  render(
    <ScreenSizeProvider value={ScreenSize.Desktop}>
      <RoomModelSettingTile room={ROOM} definition={definition} catalog={catalog} />
    </ScreenSizeProvider>
  );

const trigger = () => screen.getByRole<HTMLButtonElement>('button', { expanded: false });

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
  it('shows Use configured default when unset and highlights the default row in the shared panel', () => {
    renderTile();
    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'model']);
    expect(trigger().textContent).toBe('Use configured default');

    fireEvent.click(trigger());
    const dialog = screen.getByRole('dialog', { name: 'Model' });
    expect(
      within(dialog)
        .getByRole('option', { name: /Use configured default/ })
        .getAttribute('aria-selected')
    ).toBe('true');
  });

  it('writes selected model through useRoomSetting without calling picker mutations', async () => {
    const catalog = createCatalog();
    renderTile(MODEL_DEF, catalog);

    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep' },
      'model'
    );
    expect(catalog.selectModel).not.toHaveBeenCalled();
    expect(catalog.resetToRoomDefault).not.toHaveBeenCalled();
    expect(trigger().textContent).toBe('Deep');
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('writes key@level via the effort column on Model and omits levels on Title model', async () => {
    setLive({ value: 'deep@high' });
    renderTile();
    expect(trigger().textContent).toBe('Deep · High');

    fireEvent.click(trigger());
    const effort = screen.getByRole('radiogroup', { name: 'Effort for Deep' });
    expect(within(effort).getByRole('radio', { name: 'High' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    await act(async () => {
      fireEvent.click(within(effort).getByRole('radio', { name: 'Low' }));
    });
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep@low' },
      'model'
    );
    expect(trigger().textContent).toBe('Deep · Low');

    cleanup();
    setLive({ value: 'deep' });
    renderTile(TITLE_MODEL_DEF);
    fireEvent.click(trigger());
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Quick/ }));
    });
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'fast' },
      'thread_summary_model'
    );
  });

  it('shows unknown values raw, never as Default, and resets them to {}', async () => {
    setLive({ value: 'retired-model' });
    renderTile();

    expect(trigger().textContent).toBe('retired-model');
    expect(
      screen.getByText('Unknown model: "retired-model" is not in this room\'s model list.')
    ).toBeTruthy();

    fireEvent.click(trigger());
    expect(
      screen.getByRole('option', { name: /Use configured default/ }).getAttribute('aria-selected')
    ).toBe('false');
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Use configured default/ }));
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      {},
      'model'
    );
    expect(trigger().textContent).toBe('Use configured default');
  });

  it('marks an invalid reasoning level on a known model as unknown', () => {
    setLive({ value: 'deep@bogus' });
    renderTile();
    expect(trigger().textContent).toBe('deep@bogus');
    expect(
      screen.getByText('Unknown model: "deep@bogus" is not in this room\'s model list.')
    ).toBeTruthy();
  });

  it('shows the raw value and allows reset and retry when no catalog is available', async () => {
    setLive({ value: 'saved-model' });
    const catalog = createCatalog({
      eligible: false,
      runtimes: [],
      runtime: undefined,
      models: [],
      loading: false,
    });
    renderTile(MODEL_DEF, catalog);

    expect(trigger().textContent).toBe('saved-model');
    expect(screen.getByText('Configured value: saved-model')).toBeTruthy();
    expect(screen.queryByText(/Unknown model:/)).toBeNull();

    fireEvent.click(trigger());
    expect(catalog.refresh).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog', { name: 'Model' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(catalog.refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Use configured default' }));
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      {},
      'model'
    );
    expect(trigger().textContent).toBe('Use configured default');
  });

  it('shows an alert on write failure and stays read-only for non-editors', async () => {
    setLive({ value: 'fast' });
    client.sendStateEvent.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    renderTile();

    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    });
    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(trigger().textContent).toBe('Quick');

    cleanup();
    live.canSend = false;
    renderTile();
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toBe('Quick');
    expect(screen.getByText(READ_ONLY)).toBeTruthy();
  });

  it('keeps the picker open with real FocusTrap when a late catalog arrives while open', async () => {
    const loadingCatalog = createCatalog({
      eligible: false,
      runtimes: [],
      runtime: undefined,
      models: [],
      loading: true,
    });
    const { rerender } = renderTile(MODEL_DEF, loadingCatalog);

    fireEvent.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Model' })).toBeTruthy();

    // Catalog arrives while the menu is already open; the single FocusTrap must not deactivate.
    rerender(
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <RoomModelSettingTile room={ROOM} definition={MODEL_DEF} catalog={createCatalog()} />
      </ScreenSizeProvider>
    );

    const dialog = screen.getByRole('dialog', { name: 'Model' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('option', { name: /Deep/ }));
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep' },
      'model'
    );
  });
});
