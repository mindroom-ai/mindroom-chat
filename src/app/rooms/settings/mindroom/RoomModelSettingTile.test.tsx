// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_SETTINGS_EVENT } from '../../../matrix/protocol/roomSettings';
import type { ModelCatalogEntry } from '../../../models/modelProtocol';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { ScreenSize, ScreenSizeProvider } from '../../../lib/hooks/useScreenSize';
import {
  ROOM_SETTING_DEFINITIONS,
  type RoomModelSettingDefinition,
} from './roomSettingDefinitions';
import { RoomModelSettingTile } from './RoomModelSettingTile';

const ROOM = { roomId: '!room:example.test' } as Room;
const MODEL_DEF = ROOM_SETTING_DEFINITIONS.find(
  (d): d is RoomModelSettingDefinition => d.key === 'model'
)!;
const TITLE_MODEL_DEF = ROOM_SETTING_DEFINITIONS.find(
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
  { key: 'mini', display_name: 'Mini', provider: 'other', id: 'other-mini' },
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
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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
  ErrorActions: 'ErrorActions',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
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
}));
vi.mock('./RoomModelSettingTile.css', () => ({
  TriggerButton: 'TriggerButton',
  Unavailable: 'Unavailable',
  RetryButton: 'RetryButton',
}));
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
  toRem: (px: number) => `${px / 16}rem`,
}));
vi.mock('../../../ui/SettingTile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description?: string;
    after: React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      {description && <span>{description}</span>}
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

const renderTile = ({
  definition = MODEL_DEF,
  catalog = createCatalog(),
  screenSize = ScreenSize.Desktop,
}: {
  definition?: RoomModelSettingDefinition;
  catalog?: ModelPickerState;
  screenSize?: ScreenSize;
} = {}) =>
  render(
    <ScreenSizeProvider value={screenSize}>
      <RoomModelSettingTile room={ROOM} definition={definition} catalog={catalog} />
    </ScreenSizeProvider>
  );

const trigger = () => screen.getByRole<HTMLButtonElement>('button', { expanded: undefined });

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
  it('shows Use configured default when unset and marks the default row selected', () => {
    const catalog = createCatalog();
    renderTile({ catalog });
    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'model']);
    expect(trigger().textContent).toBe('Use configured default');

    fireEvent.click(trigger());
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    const defaultOption = within(listbox).getByRole('option', {
      name: /Use configured default/,
    });
    expect(defaultOption.getAttribute('aria-selected')).toBe('true');
    expect(
      within(listbox).getByRole('option', { name: /Quick/ }).getAttribute('aria-selected')
    ).toBe('false');
  });

  it('selects a known model, writes via useRoomSetting, and never calls picker mutations', async () => {
    const catalog = createCatalog();
    renderTile({ catalog });

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

  it('offers reasoning levels for Model and writes key@level or plain key', async () => {
    setLive({ value: 'deep@high' });
    const catalog = createCatalog();
    renderTile({ catalog });
    expect(trigger().textContent).toBe('Deep · High');

    fireEvent.click(trigger());
    expect(screen.getByRole('option', { name: /Deep/ }).getAttribute('aria-selected')).toBe('true');
    const effortGroup = screen.getByRole('radiogroup', { name: 'Effort for Deep' });
    expect(
      within(effortGroup).getByRole('radio', { name: 'High' }).getAttribute('aria-checked')
    ).toBe('true');

    await act(async () => {
      fireEvent.click(within(effortGroup).getByRole('radio', { name: 'Low' }));
    });
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep@low' },
      'model'
    );
    expect(trigger().textContent).toBe('Deep · Low');

    // Picking the model row itself writes the plain key (model default level).
    setLive({ value: 'deep@low' }, '$sent0');
    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
    });
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep' },
      'model'
    );
  });

  it('writes plain keys without effort column for Title model', async () => {
    setLive({ value: 'deep' });
    const catalog = createCatalog();
    renderTile({ definition: TITLE_MODEL_DEF, catalog });
    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'thread_summary_model']);

    fireEvent.click(trigger());
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Quick/ }));
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'fast' },
      'thread_summary_model'
    );
  });

  it('shows an unknown value raw, marks it unknown, never as Default, and lets reset clear it', async () => {
    setLive({ value: 'retired-model' });
    const catalog = createCatalog();
    renderTile({ catalog });

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

  it('marks an unrecognized reasoning level on a known model as unknown', () => {
    setLive({ value: 'deep@bogus' });
    renderTile({ catalog: createCatalog() });
    expect(trigger().textContent).toBe('deep@bogus');
    expect(
      screen.getByText('Unknown model: "deep@bogus" is not in this room\'s model list.')
    ).toBeTruthy();
  });

  it('still shows the raw value and allows reset when no catalog is available', async () => {
    setLive({ value: 'saved-model' });
    const catalog = createCatalog({
      eligible: false,
      runtimes: [],
      runtime: undefined,
      models: [],
      loading: false,
    });
    renderTile({ catalog });

    expect(trigger().textContent).toBe('saved-model');
    // Without a catalog, do not falsely claim the value is unknown.
    expect(screen.queryByText(/Unknown model:/)).toBeNull();

    fireEvent.click(trigger());
    expect(catalog.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'No model list is available right now. You can still reset to the configured default.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: /Use configured default/ }).getAttribute('aria-selected')
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(catalog.refresh).toHaveBeenCalledTimes(2);

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

  it('filters long catalogs with search and supports keyboard selection', async () => {
    const manyModels: ModelCatalogEntry[] = Array.from({ length: 10 }, (_, index) => ({
      key: `model-${index}`,
      display_name: `Model ${index}`,
      provider: 'acme',
      id: `acme-model-${index}`,
    }));
    renderTile({ catalog: createCatalog({ models: manyModels }) });

    fireEvent.click(trigger());
    const search = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search models' });
    fireEvent.change(search, { target: { value: 'Model 9' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(search, { key: 'Enter' });
    });
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'model-9' },
      'model'
    );
  });

  it('shows save failure alert and keeps the previous room value on rejection', async () => {
    setLive({ value: 'fast' });
    client.sendStateEvent.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    renderTile({ catalog: createCatalog() });

    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Mini/ }));
    });
    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(trigger().textContent).toBe('Quick');
  });

  it('is read-only for non-editors', () => {
    live.canSend = false;
    setLive({ value: 'fast' });
    renderTile({ catalog: createCatalog() });

    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toBe('Quick');
    expect(screen.getByText(READ_ONLY)).toBeTruthy();
  });

  it('lets editors switch runtimes when multiple runtimes answered', () => {
    const secondRuntime = {
      id: '@mindroom_other:example.test:DEV2',
      userId: '@mindroom_other:example.test',
      deviceId: 'DEV2',
      curveKey: 'curve-2',
    };
    const catalog = createCatalog({
      runtimes: [RUNTIME, secondRuntime],
      runtime: undefined,
      models: [],
    });
    renderTile({ catalog });

    fireEvent.click(trigger());
    const runtimeSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Runtime' });
    fireEvent.change(runtimeSelect, { target: { value: secondRuntime.id } });
    expect(catalog.chooseRuntime).toHaveBeenCalledWith(secondRuntime.id);
  });

  it('opens the stacked effort view on mobile and writes model@level', async () => {
    setLive({ value: 'deep' });
    renderTile({ catalog: createCatalog(), screenSize: ScreenSize.Mobile });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /Effort/ }));
    const effortGroup = screen.getByRole('radiogroup', { name: 'Effort for Deep' });
    await act(async () => {
      fireEvent.click(within(effortGroup).getByRole('radio', { name: 'High' }));
    });
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'deep@high' },
      'model'
    );
  });
});
