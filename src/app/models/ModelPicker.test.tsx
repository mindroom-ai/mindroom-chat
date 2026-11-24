// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Room } from 'matrix-js-sdk';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogEntry } from './modelProtocol';
import type { ModelPickerState } from './useModelPicker';
import {
  describeDefault,
  ModelPicker,
  ThreadModelPicker,
  TrappedModelPickerPanel,
} from './ModelPicker';
import contractFixture from '../usage/__fixtures__/providerUsageContract.json';
import {
  snapshotForRuntime,
  type ProviderUsageRuntime,
  type RuntimeIdentity,
} from '../usage/providerUsageController';
import type { ProviderUsageSnapshot } from '../usage/providerUsageProtocol';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { ModelIcon } from './ModelIcon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const usage: {
    available: boolean;
    runtimes: ProviderUsageRuntime[];
    snapshotsByRuntime: Record<string, ProviderUsageSnapshot>;
  } = {
    available: false,
    runtimes: [],
    snapshotsByRuntime: {},
  };
  return {
    useModelPicker: vi.fn(),
    ensureUsageLoaded: vi.fn(),
    usage,
    mxcUrlToHttp: vi.fn(() => 'https://matrix.example/media/icon'),
    touch: false,
    anchors: [] as unknown[],
  };
});

vi.mock('./ModelPicker.css', () => ({
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
  ViewStatus: 'ViewStatus',
  Empty: 'Empty',
  Error: 'Error',
  ErrorActions: 'ErrorActions',
  Group: 'Group',
  GroupHeader: 'GroupHeader',
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
  UsageFooter: 'UsageFooter',
  UsageLink: 'UsageLink',
  UsageUpdated: 'UsageUpdated',
  VisuallyHidden: 'VisuallyHidden',
}));

vi.mock('react-i18next', async () => {
  // The effort column's strings come from the English catalog.
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const strings: Record<string, string> = {
          'mindroomUi.models.modelPicker.chooseModel': 'Choose model',
          'mindroomUi.models.modelPicker.modelForThread': 'Model for this thread',
          'mindroomUi.models.modelPicker.search': 'Search models',
          'mindroomUi.models.modelPicker.models': 'Models',
          'mindroomUi.models.modelPicker.runtime': 'Runtime',
          'mindroomUi.models.modelPicker.chooseRuntime': 'Choose a runtime',
          'mindroomUi.models.modelPicker.retry': 'Retry',
          'mindroomUi.models.modelPicker.loading': 'Loading models',
          'mindroomUi.models.modelPicker.pending': 'Waiting for model change',
          'mindroomUi.models.modelPicker.noResults': 'No matching models',
          'mindroomUi.models.modelPicker.commandFallback':
            'You can still send /model (or !model) with a model key in this thread.',
          'mindroomUi.models.modelPicker.runtimeLabel': `${String(options?.userId)} on ${String(
            options?.deviceId
          )}`,
        };
        return strings[key] ?? translateFromEn(key, options);
      },
    }),
  };
});

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PopOut: ({
    children,
    content,
    anchor,
  }: {
    children?: React.ReactNode;
    content?: React.ReactNode;
    anchor?: unknown;
  }) => {
    mocks.anchors.push(anchor);
    return (
      <div>
        {children}
        {content}
      </div>
    );
  },
  Spinner: () => <span role="progressbar" aria-label="Loading" />,
}));

vi.mock('../ui/glass/GlassPrimitives', () => ({
  Menu: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => (
      <div ref={ref} data-glass-menu="" {...props}>
        {children}
      </div>
    )
  ),
  IconButton: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & Record<'variant' | 'radii' | 'size', string>
  >(({ variant: _variant, radii: _radii, size: _size, ...props }, ref) => (
    <button ref={ref} {...props} />
  )),
}));

vi.mock('../ui/IconTooltip', () => ({
  IconTooltip: ({
    label,
    hint,
    children,
  }: {
    label: string;
    hint?: string;
    children: (ref: () => void) => React.ReactNode;
  }) => (
    <>
      {children(() => undefined)}
      <span data-tooltip-label={label} data-tooltip-hint={hint} />
    </>
  ),
}));

vi.mock('../lib/user-agent', () => ({ mobileOrTablet: () => mocks.touch }));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@viewer:example.org' }),
}));

vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('../matrix/matrix', () => ({
  mxcUrlToHttp: mocks.mxcUrlToHttp,
}));

vi.mock('../usage/useProviderUsage', () => ({
  useRuntimeProviderUsage: (roomId: string | undefined, target: RuntimeIdentity | undefined) => ({
    available: mocks.usage.available,
    snapshot: snapshotForRuntime(mocks.usage, target),
    ensureLoaded: () => mocks.ensureUsageLoaded(roomId),
  }),
}));

vi.mock('./useModelPicker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModelPicker: mocks.useModelPicker,
}));

const runtime = {
  id: 'runtime-one',
  userId: '@runtime:example.org',
  deviceId: 'DESKTOP',
  curveKey: 'private-transport-key',
};

const createState = (patch: Partial<ModelPickerState> = {}): ModelPickerState => ({
  eligible: true,
  runtimes: [runtime],
  runtime,
  models: [
    {
      key: 'fast',
      display_name: 'Quick helper',
      provider: 'OpenAI',
      id: 'fast-model',
      icon_url: 'mxc://example.org/fast',
    },
    {
      key: 'reset',
      display_name: 'Deep reasoning',
      provider: 'Anthropic',
      id: 'reasoning-model',
    },
    {
      key: 'default',
      display_name: 'Named default',
      provider: 'Local',
      id: 'default-model',
    },
  ],
  override: null,
  reasoning: null,
  inherited: [{ entity: 'assistant', model: 'fast', source: 'agent' }],
  loading: false,
  pending: false,
  canMutate: true,
  refresh: vi.fn(),
  chooseRuntime: vi.fn(),
  selectModel: vi.fn(),
  resetToRoomDefault: vi.fn(),
  ...patch,
});

/** A catalog long enough to get the filter field: the three models and six more. */
const longCatalog = (): ModelCatalogEntry[] => [
  ...createState().models,
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `studio-${index + 1}`,
    display_name: `Studio model ${index + 1}`,
    provider: 'Studio',
    id: `studio-model-${index + 1}`,
  })),
];

const click = async (element: Element) => {
  await act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const input = (element: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const keyDown = async (element: Element, key: string) => {
  await act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
};

describe('composer model picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  const trigger = () => container.querySelector('button[aria-label="Choose model"]')!;
  const list = () => container.querySelector('[role="listbox"]');
  const search = () => container.querySelector('input[role="searchbox"]') as HTMLInputElement;
  const options = () => [...container.querySelectorAll('[role="option"]')];
  const optionNamed = (title: string) =>
    options().find((row) => row.querySelector('.OptionTitle')?.textContent === title)!;
  const open = async (state: ModelPickerState) => {
    act(() => root.render(<ModelPicker state={state} />));
    await click(trigger());
  };

  beforeEach(() => {
    mocks.useModelPicker.mockReset();
    mocks.ensureUsageLoaded.mockReset();
    mocks.usage.available = false;
    mocks.usage.runtimes = [];
    mocks.usage.snapshotsByRuntime = {};
    mocks.mxcUrlToHttp.mockClear();
    mocks.touch = false;
    mocks.anchors = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it('does not subscribe or render outside an existing thread', () => {
    act(() => root.render(<ThreadModelPicker room={{} as Room} />));

    expect(mocks.useModelPicker).not.toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Choose model"]')).toBeNull();
  });

  it.each(['regular room', 'router only', 'invited agent', 'left agent'])(
    'hides the selector for an ineligible %s snapshot',
    () => {
      mocks.useModelPicker.mockReturnValue(createState({ eligible: false }));

      act(() => root.render(<ThreadModelPicker room={{} as Room} threadId="$thread" />));

      expect(container.querySelector('button[aria-label="Choose model"]')).toBeNull();
      expect(container.querySelector('.TriggerDivider')).toBeNull();
    }
  );

  it('renders for the next thread in main-room mode and closes immediately on pick', () => {
    const selectModel = vi.fn();
    const state = createState({ selectModel });
    mocks.useModelPicker.mockReturnValue(state);
    const room = { roomId: '!room:test' } as Room;

    act(() => root.render(<ThreadModelPicker room={room} newThread />));

    expect(mocks.useModelPicker).toHaveBeenCalledWith(room, undefined);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose model for the next thread"]'
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.click();
    });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Choose model for the next thread'
    );
    expect(container.textContent).toContain('This pick applies to the next thread only.');
    const fast = optionNamed('Quick helper');
    act(() => {
      (fast as HTMLElement).click();
    });
    expect(selectModel).toHaveBeenCalledWith('fast');
    // Local draft closes immediately without waiting for pending round-trip.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('sets the button off from the buttons after it in a thread', () => {
    mocks.useModelPicker.mockReturnValue(createState());

    act(() => root.render(<ThreadModelPicker room={{} as Room} threadId="$thread" />));

    expect(trigger()).not.toBeNull();
    expect(container.lastElementChild?.className).toBe('TriggerDivider');
    expect(container.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the logo of the model the thread uses', () => {
    act(() => root.render(<ModelPicker state={createState({ override: 'reset' })} />));

    const path = trigger().querySelector('svg path');
    expect(path?.getAttribute('d')).toMatch(/^M17\.3041/);
    expect(trigger().querySelector('img')).toBeNull();
  });

  it("shows the logo of the room default's model when every agent uses it", () => {
    act(() => root.render(<ModelPicker state={createState()} />));

    expect(trigger().querySelector('img')?.getAttribute('src')).toBe(
      'https://matrix.example/media/icon'
    );
  });

  it('shows a generic mark while the agents fall back to different models', () => {
    const state = createState({
      inherited: [
        { entity: 'assistant', model: 'fast' },
        { entity: 'reviewer', model: 'reset' },
      ],
    });
    act(() => root.render(<ModelPicker state={state} />));

    expect(trigger().querySelector('svg')?.getAttribute('class')).toContain('tabler-icon-sparkles');
  });

  it('names the trigger "Choose model" followed by the model label it shows', () => {
    act(() => root.render(<ModelPicker state={createState({ override: 'reset' })} />));

    const [self, label, ...rest] = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');

    expect(self).toBe(trigger().id);
    expect(document.getElementById(label!)?.textContent).toBe('Deep reasoning');
    expect(rest).toEqual([]);
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
    const tooltip = container.querySelector('[data-tooltip-label]')!;
    expect(tooltip.getAttribute('data-tooltip-label')).toBe('Choose model');
    expect(tooltip.getAttribute('data-tooltip-hint')).toBe('Deep reasoning');
  });

  it('opens a glass menu named for the thread, with no filter field for a short catalog', async () => {
    await open(createState());

    const menu = container.querySelector('[role="dialog"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Model for this thread');
    expect(menu.hasAttribute('data-glass-menu')).toBe(true);
    expect(search()).toBeNull();
    expect(list()).toBe(document.activeElement);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('lists each model by name over its model ID, under its provider, and checks the current one', async () => {
    await open(createState({ override: 'reset' }));

    const reasoning = optionNamed('Deep reasoning');
    expect(reasoning.querySelector('.OptionDetail')?.textContent).toBe('reasoning-model');
    expect(reasoning.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Anthropic');
    expect(reasoning.getAttribute('aria-selected')).toBe('true');
    expect(reasoning.querySelector('.Check')).not.toBeNull();
    expect(optionNamed('Quick helper').querySelector('.Check')).toBeNull();
  });

  it('names each agent by the room member of the account the runtime gives, else by its entity', async () => {
    // Two runtimes' helpers share the entity name; only the account tells them apart.
    const names: Record<string, string> = {
      '@mindroom_helper:example.org': 'Helper at home',
      '@mindroom_helper_work1:example.org': 'Helper at work',
    };
    const room = {
      getMember: (userId: string) => (names[userId] ? { name: names[userId] } : null),
    } as unknown as Room;
    const state = createState({
      override: 'reset',
      inherited: [
        {
          entity: 'helper',
          model: 'fast',
          source: 'agent',
          user_id: '@mindroom_helper_work1:example.org',
        },
        { entity: 'reviewer', model: 'legacy-key', source: 'agent' },
        { entity: 'scout', model: 'fast', source: 'agent', user_id: '@mindroom_scout:example.org' },
      ],
    });
    act(() => root.render(<ModelPicker state={state} room={room} />));
    await click(trigger());

    const details = optionNamed('Agent default').querySelectorAll('.RoomDefaultDetail');
    expect([...details].map((detail) => detail.textContent)).toEqual([
      'Helper at work: Quick helper · reviewer: legacy-key · scout: Quick helper',
      'Choosing a model here applies to this thread only.',
    ]);
  });

  it('names a room model set with !room_model, and explains the row before the router answers', async () => {
    await open(
      createState({ inherited: [{ entity: 'assistant', model: 'fast', source: 'room' }] })
    );
    expect(optionNamed('Room model').textContent).toBe(
      'Room modelassistant · Quick helperSet for this room with !room_model. Choosing a model here applies to this thread only.'
    );
    act(() => root.render(<ModelPicker state={createState({ inherited: [] })} />));
    expect(optionNamed('Default').querySelector('.RoomDefaultDetail')?.textContent).toBe(
      'Choosing a model here applies to this thread only.'
    );
  });

  it('opens on the current model, where Enter only closes the menu', async () => {
    const state = createState({ override: 'reset' });
    await open(state);
    expect(list()?.getAttribute('aria-activedescendant')).toBe(optionNamed('Deep reasoning').id);

    await keyDown(list()!, 'Enter');

    expect(state.selectModel).not.toHaveBeenCalled();
    expect(list()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('moves the highlight to the current model once a late catalog lists it', async () => {
    const state = createState({ override: 'fast' });
    await open({ ...state, models: [] });

    act(() => root.render(<ModelPicker state={state} />));
    expect(list()?.getAttribute('aria-activedescendant')).toBe(optionNamed('Quick helper').id);
    await keyDown(list()!, 'Enter');

    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
    expect(list()).toBeNull();
  });

  it('keeps a highlight the user moved when the selection changes', async () => {
    const state = createState();
    await open(state);
    await keyDown(list()!, 'ArrowDown');

    act(() => root.render(<ModelPicker state={{ ...state, override: 'reset' }} />));

    expect(list()?.getAttribute('aria-activedescendant')).toBe(optionNamed('Quick helper').id);
  });

  it('supports arrow selection, Enter, and Escape from the list', async () => {
    const state = createState();
    await open(state);

    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('fast');

    await keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('keeps room reset distinct from selecting a model whose stable key is default', async () => {
    const state = createState();
    await open(state);

    await click(optionNamed('Named default'));
    expect(state.selectModel).toHaveBeenCalledWith('default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();

    act(() => root.render(<ModelPicker state={{ ...state, override: 'default' }} />));
    expect(optionNamed('Agent default').getAttribute('aria-selected')).toBe('false');
    expect(optionNamed('Named default').getAttribute('aria-selected')).toBe('true');
    await click(optionNamed('Agent default'));
    expect(state.resetToRoomDefault).toHaveBeenCalledOnce();
  });

  it('sets a configured model whose key matches the room-default DOM identity', async () => {
    const state = createState({
      models: [
        {
          key: 'room-default',
          display_name: 'Configured fallback',
          provider: 'Local',
          id: 'configured-fallback',
        },
      ],
    });
    await open(state);

    await click(optionNamed('Configured fallback'));

    expect(state.selectModel).toHaveBeenCalledWith('room-default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
  });

  it('moves through options in the same order as interleaved provider groups render', async () => {
    const state = createState({
      models: [
        { key: 'a', display_name: 'Alpha', provider: 'OpenAI', id: 'a-model' },
        { key: 'b', display_name: 'Beta', provider: 'Anthropic', id: 'b-model' },
        { key: 'c', display_name: 'Charlie', provider: 'OpenAI', id: 'c-model' },
      ],
    });
    await open(state);

    const rendered = options().map((option) => option.textContent);
    expect(rendered[1]).toContain('Alpha');
    expect(rendered[2]).toContain('Charlie');

    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'Enter');

    expect(state.selectModel).toHaveBeenCalledWith('c');
  });

  it('adds a filter field past eight models, matching name, key, provider and model ID', async () => {
    await open(createState({ models: longCatalog() }));

    expect(search()).toBe(document.activeElement);
    expect(search().getAttribute('placeholder')).toBe('Search models');

    input(search(), 'quick');
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining('Quick helper'),
    ]);

    input(search(), 'reset');
    expect(options()[0]?.textContent).toContain('Deep reasoning');

    input(search(), 'studio-model-6');
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Studio model 6');

    input(search(), 'local');
    expect(container.querySelector('[role="group"]')?.textContent).toContain('Local');
    expect(options()[0]?.textContent).toContain('Named default');

    input(search(), 'no such model');
    expect(container.textContent).toContain('No matching models');
  });

  it('picks the first match with Enter and moves with the arrows from the filter field', async () => {
    const state = createState({ models: longCatalog() });
    await open(state);

    input(search(), 'studio');
    expect(search().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    await keyDown(search(), 'ArrowDown');
    expect(search().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    await keyDown(search(), 'ArrowUp');
    await keyDown(search(), 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('studio-1');

    await keyDown(search(), 'Escape');
    expect(search()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('keeps the keys working when a refresh adds the filter field under the focused list', async () => {
    const state = createState({ models: longCatalog().slice(0, 8) });
    await open(state);
    expect(list()).toBe(document.activeElement);

    act(() => root.render(<ModelPicker state={{ ...state, models: longCatalog() }} />));
    expect(search()).not.toBeNull();
    expect(list()).toBe(document.activeElement);
    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'Enter');

    expect(state.selectModel).toHaveBeenCalledWith('fast');
  });

  it('drops the filter and gives the list focus when the catalog shrinks under the field', async () => {
    const state = createState({ models: longCatalog() });
    await open(state);
    input(search(), 'studio');
    expect(search()).toBe(document.activeElement);

    act(() => root.render(<ModelPicker state={{ ...state, models: createState().models }} />));

    expect(search()).toBeNull();
    expect(options().map((option) => option.querySelector('.OptionTitle')?.textContent)).toEqual([
      'Agent default',
      'Quick helper',
      'Deep reasoning',
      'Named default',
    ]);
    expect(list()).toBe(document.activeElement);
  });

  it('shows no filter field for exactly eight models', async () => {
    await open(createState({ models: longCatalog().slice(0, 8) }));

    expect(search()).toBeNull();
    expect(list()).toBe(document.activeElement);
  });

  it('focuses the list, not the filter field, on a touch device, and the list takes the keys', async () => {
    mocks.touch = true;
    const state = createState({ models: longCatalog() });
    await open(state);

    expect(search()).not.toBeNull();
    expect(list()).toBe(document.activeElement);
    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('fast');
  });

  it('measures its button again once the page changes size while it is open', async () => {
    const resized: Array<() => void> = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }

        observe(element: Element) {
          observed.push(element);
        }

        disconnect = disconnect;
      }
    );
    try {
      await open(createState());
      expect(observed).toEqual([document.body]);
      const moved = { x: 16, y: 300, width: 32, height: 32, top: 300, left: 16, right: 48 };
      trigger().getBoundingClientRect = () => ({ ...moved, bottom: 332, toJSON: () => moved });

      act(() => resized.forEach((callback) => callback()));

      expect(mocks.anchors.at(-1)).toMatchObject({ y: 300 });
      await keyDown(list()!, 'Escape');
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([true, false])(
    'keeps the verified runtime chooser usable (loading=%s)',
    async (loading) => {
      const secondRuntime = {
        ...runtime,
        id: 'runtime-two',
        userId: '@second-runtime:example.org',
        deviceId: 'MOBILE',
      };
      const state = createState({
        runtimes: [runtime, secondRuntime],
        runtime: undefined,
        loading,
        canMutate: false,
        models: [],
        inherited: [],
      });
      await open(state);

      const chooser = container.querySelector('select[aria-label="Runtime"]') as HTMLSelectElement;
      expect(chooser.textContent).toContain('@runtime:example.org on DESKTOP');
      expect(chooser.textContent).toContain('@second-runtime:example.org on MOBILE');
      if (loading) {
        expect(container.textContent).not.toContain('No matching models');
      } else {
        expect(optionNamed('Default').getAttribute('aria-selected')).toBe('false');
        expect(trigger().hasAttribute('aria-labelledby')).toBe(false);
      }

      act(() => {
        chooser.value = 'runtime-two';
        chooser.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(state.chooseRuntime).toHaveBeenCalledWith('runtime-two');
    }
  );

  it('shows only loading status while discovery has no models to list', async () => {
    const state = createState({
      models: [],
      inherited: [],
      runtime: undefined,
      canMutate: false,
      loading: true,
      error: 'Previous discovery failed.',
    });
    await open(state);

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading models');
    expect(container.textContent).not.toContain('No matching models');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(options()).toHaveLength(0);
    expect(list()).toBe(document.activeElement);
  });

  it('shows a cached catalog without presenting it as the current choice', async () => {
    await open(createState({ runtime: undefined, loading: true, canMutate: false }));

    expect(trigger().hasAttribute('aria-labelledby')).toBe(false);
    expect(trigger().hasAttribute('data-effort')).toBe(false);
    expect(options().length).toBeGreaterThan(0);
    expect(options().every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('renders distinct option IDs for cached keys with and without a lone surrogate', async () => {
    const models = ['\uD800', '\\ud800'].map((key) => ({
      key,
      display_name: 'Stored model',
      provider: 'local',
      id: 'model',
    }));
    await open(createState({ models, runtime: undefined, canMutate: false }));

    expect(new Set(options().map(({ id }) => id)).size).toBe(3);
  });

  it('keeps cached models searchable during discovery without enabling changes', async () => {
    await open(createState({ models: longCatalog(), loading: true, canMutate: false }));

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading models');
    input(search(), 'studio-model-6');
    expect(options()).toEqual([optionNamed('Studio model 6')]);
    expect(options()[0]?.getAttribute('aria-disabled')).toBe('true');
    input(search(), 'no such model');
    expect(container.textContent).toContain('No matching models');
  });

  it('refreshes on opening and keeps dismissal available while a command is pending', async () => {
    const state = createState({ pending: true, loading: true, canMutate: false });
    await open(state);

    expect(state.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Waiting for model change'
    );
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(options()[0]?.getAttribute('aria-disabled')).toBe('true');

    await keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
  });

  it('uses controller availability for model and reset activation while recovery is blocked', async () => {
    const state = createState({
      canMutate: false,
      pending: false,
      loading: false,
      error: 'Recovery unavailable.',
    });
    await open(state);
    expect(options().every((option) => option.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    for (const option of options()) {
      await click(option);
    }
    await keyDown(list()!, 'Enter');
    await keyDown(list()!, 'ArrowDown');
    await keyDown(list()!, 'Enter');
    expect(state.selectModel).not.toHaveBeenCalled();
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
    await click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    await keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
    await click(trigger());
    act(() =>
      root.render(<ModelPicker state={{ ...state, canMutate: true, override: 'reset' }} />)
    );
    expect(options().every((option) => option.getAttribute('aria-disabled') === 'false')).toBe(
      true
    );
    // The highlight starts on the current model, Deep reasoning.
    await keyDown(list()!, 'ArrowUp');
    await keyDown(list()!, 'Enter');
    await keyDown(list()!, 'ArrowUp');
    await keyDown(list()!, 'Enter');
    expect(state.resetToRoomDefault).toHaveBeenCalledOnce();
    expect(state.selectModel).toHaveBeenCalledWith('fast');
  });

  it('gives the list focus when Retry goes while it has focus', async () => {
    const state = createState({ error: 'Model discovery unavailable.' });
    await open(state);
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Retry"]')!;
    retry.focus();

    act(() => root.render(<ModelPicker state={{ ...state, error: undefined }} />));

    expect(container.querySelector('button[aria-label="Retry"]')).toBeNull();
    expect(list()).toBe(document.activeElement);
  });

  it('keeps an error open with retry and readable command fallback', async () => {
    const state = createState({ error: 'Model discovery unavailable.' });
    await open(state);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Model discovery unavailable.'
    );
    expect(container.textContent).toContain(
      'You can still send /model (or !model) with a model key'
    );
    await click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });

  it('closes once the router applies the chosen model', async () => {
    const state = createState();
    await open(state);
    await click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    expect(list()).not.toBeNull();
    act(() => root.render(<ModelPicker state={{ ...state, override: 'fast' }} />));

    expect(list()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('does not steal focus when a dismissed pending command later succeeds', async () => {
    const state = createState();
    const outside = document.createElement('input');
    document.body.append(outside);
    await open(state);
    await click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    await keyDown(list()!, 'Escape');
    outside.focus();
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(document.activeElement).toBe(outside);
  });

  it('does not let a command acknowledged while dismissed close a later opening', async () => {
    const state = createState();
    await open(state);
    await click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    await keyDown(list()!, 'Escape');
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));
    await click(trigger());

    expect(list()).not.toBeNull();
  });

  it('does not let a dismissed command close a reopening when its acknowledgement arrives', async () => {
    const state = createState();
    await open(state);
    await click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    await keyDown(list()!, 'Escape');
    await click(trigger());
    expect(list()).not.toBeNull();

    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(list()).not.toBeNull();
  });

  it('closes as the conversation it is in hides', async () => {
    const state = createState();
    await open(state);
    expect(list()).not.toBeNull();

    act(() => root.render(<ModelPicker state={state} conversationHidden />));

    expect(list()).toBeNull();
  });

  it('loads custom icons through authenticated Matrix media and falls back on image error', async () => {
    act(() =>
      root.render(
        <ModelIcon provider="OpenAI" id="fast-model" iconUrl="mxc://example.org/fast" size={24} />
      )
    );

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://matrix.example/media/icon');
    expect(mocks.mxcUrlToHttp).toHaveBeenCalledWith(
      expect.anything(),
      'mxc://example.org/fast',
      true,
      48,
      48,
      'scale'
    );

    await act(() => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  describe('effort column', () => {
    const sol: ModelCatalogEntry = {
      key: 'sol',
      display_name: 'Sol',
      provider: 'Codex',
      id: 'gpt-sol',
      reasoning_levels: ['low', 'medium', 'high', 'xhigh'],
      reasoning_default: 'high',
    };
    const luna: ModelCatalogEntry = {
      key: 'luna',
      display_name: 'Luna',
      provider: 'Codex',
      id: 'gpt-luna',
      reasoning_levels: ['off', 'low', 'medium'],
      reasoning_default: 'low',
    };
    const levelled = (patch: Partial<ModelPickerState> = {}) =>
      createState({ models: [...createState().models, sol, luna], ...patch });
    const column = () => container.querySelector('[data-effort-column]');
    const group = () => container.querySelector('[role="radiogroup"]');
    const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const radio = (name: string) =>
      radios().find((row) => row.getAttribute('aria-label') === name)!;
    const header = () => container.querySelector('.EffortHeader')?.textContent;
    const hover = async (title: string) => {
      await act(() =>
        optionNamed(title).dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
      );
    };

    it('shows no column while no model has levels', async () => {
      await open(createState());
      expect(column()).toBeNull();
      expect(container.querySelector('[role="dialog"]')?.className).toBe('Panel');
    });

    it("lists the current model's levels with a check on its level and Default on its default", async () => {
      await open(levelled({ override: 'sol', reasoning: 'xhigh' }));

      expect(container.querySelector('[role="dialog"]')?.className).toBe('EffortPanel');
      expect(header()).toBe('EffortSol');
      expect(group()?.getAttribute('aria-label')).toBe('Effort for Sol');
      expect(radios().map((row) => row.getAttribute('aria-label'))).toEqual([
        'Low',
        'Medium',
        'High, default',
        'Extra high',
      ]);
      expect(radios().map((row) => row.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
        'false',
        'true',
      ]);
      expect(radio('High, default').textContent).toBe('HighDefault');
      expect(radio('Extra high').querySelector('.Check')).not.toBeNull();
    });

    it("stays on the thread's model while the pointer and the keys move over other rows", async () => {
      const state = levelled({ override: 'sol', reasoning: 'xhigh' });
      await open(state);

      // Luna has levels of its own, Quick helper none: the column shows neither.
      await hover('Luna');
      expect(optionNamed('Luna').getAttribute('data-active')).toBe('true');
      expect(header()).toBe('EffortSol');
      await hover('Quick helper');
      expect(group()?.getAttribute('aria-label')).toBe('Effort for Sol');
      await keyDown(list()!, 'ArrowDown');
      await keyDown(list()!, 'ArrowDown');
      expect(header()).toBe('EffortSol');
      expect(radio('Extra high').getAttribute('aria-checked')).toBe('true');

      await click(radio('Low'));
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol', 'low');
    });

    it("applies a level to the thread's model with one command, then closes", async () => {
      const state = levelled({ override: 'sol' });
      await open(state);
      await click(radio('Medium'));

      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol', 'medium');
      expect(state.resetToRoomDefault).not.toHaveBeenCalled();
      act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
      act(() => root.render(<ModelPicker state={{ ...state, reasoning: 'medium' }} />));
      expect(list()).toBeNull();
    });

    it('closes without a command for the level the thread already runs at', async () => {
      const state = levelled({ override: 'sol', reasoning: 'xhigh' });
      await open(state);
      await click(radio('Extra high'));

      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).toBeNull();
    });

    it('closes without a command for the level of an override that equals the room default', async () => {
      const state = levelled({
        override: 'sol',
        reasoning: 'medium',
        inherited: [{ entity: 'assistant', model: 'sol', reasoning: 'medium' }],
      });
      await open(state);
      expect(radio('Medium').getAttribute('aria-checked')).toBe('true');
      await click(radio('Medium'));

      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).toBeNull();
    });

    it("resets the current model's row to its default level with one command", async () => {
      const state = levelled({ override: 'sol', reasoning: 'xhigh' });
      await open(state);
      await click(optionNamed('Sol'));
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol');
    });

    it("resets the current model's level with Enter on its row", async () => {
      const state = levelled({ override: 'sol', reasoning: 'low' });
      await open(state);
      await keyDown(list()!, 'Enter');
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol');
    });

    it('only closes on the current model row while it runs at its default level', async () => {
      const state = levelled({ override: 'sol' });
      await open(state);
      await click(optionNamed('Sol'));
      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).toBeNull();
    });

    it("keeps the levels, and a focused one, on the thread's model when a refresh adds a model", async () => {
      const state = levelled({ override: 'sol', reasoning: 'medium' });
      await open(state);
      await hover('Luna');
      await keyDown(list()!, 'ArrowRight');
      await keyDown(document.activeElement!, 'ArrowDown');
      expect(document.activeElement).toBe(radio('High, default'));

      const nova: ModelCatalogEntry = { ...sol, key: 'nova', display_name: 'Nova', id: 'gpt-nova' };
      const models = [...createState().models, nova, sol, luna];
      act(() => root.render(<ModelPicker state={{ ...state, models }} />));

      expect(header()).toBe('EffortSol');
      expect(radio('Medium').getAttribute('aria-checked')).toBe('true');
      expect(document.activeElement).toBe(radio('High, default'));
      await click(document.activeElement!);
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol', 'high');
    });

    it('gives the list the keys when the thread moves to another model under a focused level', async () => {
      const state = levelled({ override: 'sol', reasoning: 'medium' });
      await open(state);
      await keyDown(list()!, 'ArrowRight');
      expect(document.activeElement).toBe(radio('Medium'));

      // Luna offers Medium too: its button is another one, so the focused level never changes model.
      act(() => root.render(<ModelPicker state={{ ...state, override: 'luna' }} />));

      expect(header()).toBe('EffortLuna');
      expect(document.activeElement).toBe(list());
    });

    it("checks the room default's shared level, where picking it changes nothing", async () => {
      const state = levelled({
        inherited: [{ entity: 'assistant', model: 'sol', reasoning: 'medium' }],
      });
      await open(state);
      // Neither the default row nor the model's own row changes what the column says.
      expect(header()).toBe('EffortSol');
      await hover('Sol');
      expect(radio('Medium').getAttribute('aria-checked')).toBe('true');

      await click(radio('Medium'));
      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).toBeNull();
    });

    it("pins the room default's model at another level with one pick", async () => {
      const state = levelled({
        inherited: [{ entity: 'assistant', model: 'sol', reasoning: 'medium' }],
      });
      await open(state);
      await click(radio('Low'));
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('sol', 'low');
    });

    it("pins the room default's model with a click on its row", async () => {
      const state = levelled({
        inherited: [{ entity: 'assistant', model: 'sol', reasoning: 'medium' }],
      });
      await open(state);
      await click(optionNamed('Sol'));
      expect(state.selectModel).toHaveBeenCalledWith('sol');
    });

    it('checks no level while the agents run the shared model at different levels', async () => {
      const state = levelled({
        inherited: [
          { entity: 'assistant', model: 'sol', reasoning: 'low' },
          { entity: 'reviewer', model: 'sol' },
        ],
      });
      await open(state);
      expect(header()).toBe('EffortSol');
      expect(radios().every((row) => row.getAttribute('aria-checked') === 'false')).toBe(true);
      // The keys enter at the default, and any level is a change.
      await keyDown(list()!, 'ArrowRight');
      expect(document.activeElement).toBe(radio('High, default'));
      await click(radio('Low'));
      expect(state.selectModel).toHaveBeenCalledWith('sol', 'low');
    });

    it('checks the default level and still marks it Default', async () => {
      await open(levelled({ override: 'sol' }));
      const high = radio('High, default');
      expect(high.getAttribute('aria-checked')).toBe('true');
      expect(high.querySelector('.Check')).not.toBeNull();
      expect(high.querySelector('.EffortDefault')?.textContent).toBe('Default');
    });

    it('applies a model row at its default level, as before', async () => {
      const state = levelled({ override: 'sol', reasoning: 'xhigh' });
      await open(state);
      await click(optionNamed('Luna'));
      expect(state.selectModel).toHaveBeenCalledTimes(1);
      expect(state.selectModel).toHaveBeenCalledWith('luna');
    });

    it('sends nothing from a level while mutations are blocked', async () => {
      const state = levelled({ override: 'sol', canMutate: false });
      await open(state);
      await click(radio('Low'));
      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).not.toBeNull();
    });

    it('moves into the levels with ArrowRight, between them with Up and Down, and back with Left', async () => {
      const state = levelled({ override: 'sol', reasoning: 'medium' });
      await open(state);

      // Whichever row the highlight is on, the keys enter the thread's model's levels.
      await keyDown(list()!, 'ArrowDown');
      expect(optionNamed('Luna').getAttribute('data-active')).toBe('true');
      await keyDown(list()!, 'ArrowRight');
      expect(document.activeElement).toBe(radio('Medium'));
      expect(radio('Medium').tabIndex).toBe(0);
      expect(radio('Low').tabIndex).toBe(-1);
      await keyDown(document.activeElement!, 'ArrowDown');
      expect(document.activeElement).toBe(radio('High, default'));
      await keyDown(document.activeElement!, 'ArrowDown');
      await keyDown(document.activeElement!, 'ArrowDown');
      expect(document.activeElement).toBe(radio('Extra high'));
      await keyDown(document.activeElement!, 'ArrowUp');
      expect(document.activeElement).toBe(radio('High, default'));

      await keyDown(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(list());
      await keyDown(list()!, 'ArrowRight');
      await keyDown(document.activeElement!, 'Escape');
      expect(document.activeElement).toBe(list());
      expect(list()).not.toBeNull();
      // A button's Enter is its click.
      await keyDown(list()!, 'ArrowRight');
      await click(document.activeElement!);
      expect(state.selectModel).not.toHaveBeenCalled();
      expect(list()).toBeNull();
    });

    it('enters the levels from the filter field only from the end of its text, and returns to it', async () => {
      await open(levelled({ models: [...longCatalog(), sol], override: 'sol' }));
      input(search(), 'sol');
      search().setSelectionRange(0, 0);
      await keyDown(search(), 'ArrowRight');
      expect(document.activeElement).toBe(search());
      search().setSelectionRange(3, 3);
      await keyDown(search(), 'ArrowRight');
      expect(document.activeElement).toBe(radio('High, default'));
      await keyDown(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(search());
    });

    it.each(['ArrowLeft', 'Escape'])(
      'returns from the levels to the list on a phone, where the list had focus (%s)',
      async (key) => {
        mocks.touch = true;
        await open(levelled({ models: [...longCatalog(), sol], override: 'sol' }));
        expect(document.activeElement).toBe(list());
        await keyDown(list()!, 'ArrowRight');
        expect(document.activeElement).toBe(radio('High, default'));
        await keyDown(document.activeElement!, key);
        expect(document.activeElement).toBe(list());
      }
    );

    it('names a model without levels and stays in the list on ArrowRight', async () => {
      await open(levelled({ override: 'fast' }));
      // Hovering a model with levels offers none of them: the thread does not run it.
      await hover('Sol');
      expect(header()).toBe('EffortQuick helper');
      expect(group()).toBeNull();
      expect(column()?.textContent).toContain('No effort levels');
      await keyDown(list()!, 'ArrowRight');
      expect(document.activeElement).toBe(list());
    });

    it("shows no levels under Default, and names each agent's model, while they differ", async () => {
      await open(
        levelled({
          // Both name Low, but for different models: the thread runs at no one level.
          inherited: [
            { entity: 'assistant', model: 'sol', reasoning: 'low' },
            { entity: 'reviewer', model: 'luna', reasoning: 'low' },
          ],
        })
      );
      expect(header()).toBe('EffortDefault');
      expect(column()?.textContent).toContain('No effort levels');
      expect(trigger().querySelector('[data-effort-glyph]')).toBeNull();
      const [, label] = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');
      const named = 'Default · assistant: Sol · reviewer: Luna';
      expect(document.getElementById(label!)?.textContent).toBe(named);
      expect(
        container.querySelector('[data-tooltip-label]')?.getAttribute('data-tooltip-hint')
      ).toBe(named);
    });

    describe('on a phone', () => {
      const openOnPhone = async (state: ModelPickerState) => {
        act(() =>
          root.render(
            <ScreenSizeProvider value={ScreenSize.Mobile}>
              <ModelPicker state={state} />
            </ScreenSizeProvider>
          )
        );
        await click(trigger());
      };
      const entry = () => container.querySelector<HTMLButtonElement>('[data-effort-entry]');
      const back = () => container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');

      it('shows an Effort row under the models, not the column', async () => {
        await openOnPhone(levelled({ override: 'sol', reasoning: 'xhigh' }));
        const dialog = container.querySelector('[role="dialog"]')!;
        expect(dialog.className).toBe('Panel');
        expect(column()).toBeNull();
        expect(entry()?.getAttribute('aria-label')).toBe('Effort: Extra high');
        expect(entry()?.textContent).toBe('EffortExtra high');
        expect(
          entry()?.querySelectorAll('[data-effort-glyph] rect[data-filled="true"]')
        ).toHaveLength(4);
        // Pinned under the models' box, outside what scrolls.
        expect(dialog.lastElementChild?.contains(entry())).toBe(true);
        expect(dialog.querySelector('.Picker')?.contains(entry())).toBe(false);
      });

      it('shows no row for a model without levels', async () => {
        await openOnPhone(levelled({ override: 'reset' }));
        expect(list()).not.toBeNull();
        expect(entry()).toBeNull();
        expect(column()).toBeNull();
      });

      it('opens the levels in place of the models and sends the picked one', async () => {
        const state = levelled({ override: 'sol', reasoning: 'xhigh' });
        await openOnPhone(state);
        await click(entry()!);

        expect(list()).toBeNull();
        expect(column()?.getAttribute('data-mode')).toBe('view');
        expect(header()).toBe('EffortSol');
        expect(document.activeElement).toBe(radio('Extra high'));
        expect(radio('High, default').textContent).toBe('HighDefault');
        expect(radio('Extra high').querySelector('.Check')).not.toBeNull();
        await click(radio('Low'));
        expect(state.selectModel).toHaveBeenCalledTimes(1);
        expect(state.selectModel).toHaveBeenCalledWith('sol', 'low');
        // The menu closes once the command has run, as beside the models.
        const phone = (next: ModelPickerState) => (
          <ScreenSizeProvider value={ScreenSize.Mobile}>
            <ModelPicker state={next} />
          </ScreenSizeProvider>
        );
        act(() => root.render(phone({ ...state, pending: true, canMutate: false })));
        act(() => root.render(phone({ ...state, reasoning: 'low' })));
        expect(container.querySelector('[role="dialog"]')).toBeNull();
      });

      it('closes without a command on the level the thread runs at', async () => {
        const state = levelled({ override: 'sol', reasoning: 'xhigh' });
        await openOnPhone(state);
        await click(entry()!);
        await click(radio('Extra high'));
        expect(state.selectModel).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
      });

      it('goes back to the models with Back, Escape or ArrowLeft, on the Effort row', async () => {
        await openOnPhone(levelled({ override: 'sol' }));
        await click(entry()!);
        // With no level named, the keys land on the default.
        expect(document.activeElement).toBe(radio('High, default'));
        await click(back()!);
        expect(column()).toBeNull();
        expect(list()).not.toBeNull();
        expect(document.activeElement).toBe(entry());

        await keyDown(entry()!, 'ArrowRight');
        expect(document.activeElement).toBe(radio('High, default'));
        await keyDown(document.activeElement!, 'Escape');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.activeElement).toBe(entry());

        await keyDown(list()!, 'ArrowRight');
        await keyDown(document.activeElement!, 'ArrowLeft');
        expect(document.activeElement).toBe(entry());

        await keyDown(list()!, 'Escape');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
      });

      const show = (state: ModelPickerState, size = ScreenSize.Mobile) =>
        act(() =>
          root.render(
            <ScreenSizeProvider value={size}>
              <ModelPicker state={state} />
            </ScreenSizeProvider>
          )
        );

      it('shows the wait, a rejection and Retry under the levels', async () => {
        const state = levelled({ override: 'sol', reasoning: 'xhigh' });
        await openOnPhone(state);
        await click(entry()!);
        await click(radio('Low'));
        show({ ...state, pending: true, canMutate: false });
        expect(column()?.getAttribute('data-mode')).toBe('view');
        expect(container.querySelector('[role="status"]')?.textContent).toContain(
          'Waiting for model change'
        );
        expect(radio('Low').getAttribute('aria-disabled')).toBe('true');

        show({ ...state, error: 'Level rejected.' });
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Level rejected.');
        expect(column()?.getAttribute('data-mode')).toBe('view');
        await click(container.querySelector('button[aria-label="Retry"]')!);
        // Once when the menu opened, once for Retry.
        expect(state.refresh).toHaveBeenCalledTimes(2);

        // Escape and ArrowLeft on Retry go back to the models, as from a level.
        const retry = () =>
          container.querySelector<HTMLButtonElement>('button[aria-label="Retry"]')!;
        retry().focus();
        await keyDown(retry(), 'Escape');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.activeElement).toBe(entry());
        await click(entry()!);
        retry().focus();
        await keyDown(retry(), 'ArrowLeft');
        expect(document.activeElement).toBe(entry());
      });

      it('leaves the levels when the layout widens, and keeps the keys on a control', async () => {
        const state = levelled({ override: 'sol' });
        await openOnPhone(state);
        await click(entry()!);
        show(state, ScreenSize.Desktop);
        expect(column()?.getAttribute('data-mode')).toBe('column');
        expect(document.activeElement).not.toBe(document.body);
        show(state);
        expect(column()).toBeNull();
        expect(list()).not.toBeNull();
        expect(document.activeElement).not.toBe(document.body);
        expect(container.contains(document.activeElement)).toBe(true);
        await keyDown(entry()!, 'ArrowRight');
        await keyDown(document.activeElement!, 'Escape');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.activeElement).toBe(entry());
      });

      it("leaves the levels for the list when the thread's model loses them", async () => {
        const state = levelled({ override: 'sol' });
        await openOnPhone(state);
        await click(entry()!);
        expect(document.activeElement).toBe(radio('High, default'));
        const { reasoning_levels: _levels, reasoning_default: _default, ...plain } = sol;
        show({ ...state, models: [...createState().models, plain, luna] });
        expect(column()).toBeNull();
        expect(entry()).toBeNull();
        expect(document.activeElement).toBe(list());
      });
    });

    it('adds bars for the level to the button and names the level', () => {
      act(() =>
        root.render(<ModelPicker state={levelled({ override: 'sol', reasoning: 'medium' })} />)
      );

      const bars = [...trigger().querySelectorAll('[data-effort-glyph] rect')];
      expect(bars).toHaveLength(4);
      expect(bars.map((bar) => bar.getAttribute('data-filled'))).toEqual([
        'true',
        'true',
        'false',
        'false',
      ]);
      expect(trigger().getAttribute('data-effort')).toBe('true');
      const [, label] = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');
      expect(document.getElementById(label!)?.textContent).toBe('Sol · Medium');
      expect(
        container.querySelector('[data-tooltip-label]')?.getAttribute('data-tooltip-hint')
      ).toBe('Sol · Medium');
    });

    it('fills no bar at off, which draws none of its own', () => {
      act(() =>
        root.render(<ModelPicker state={levelled({ override: 'luna', reasoning: 'off' })} />)
      );
      const bars = [...trigger().querySelectorAll('[data-effort-glyph] rect')];
      expect(bars).toHaveLength(2);
      expect(bars.every((bar) => bar.getAttribute('data-filled') === 'false')).toBe(true);
    });

    it('keeps the button of a model without levels as it was', () => {
      act(() => root.render(<ModelPicker state={levelled({ override: 'reset' })} />));
      expect(trigger().querySelector('[data-effort-glyph]')).toBeNull();
      expect(trigger().hasAttribute('data-effort')).toBe(false);
      const [, label] = (trigger().getAttribute('aria-labelledby') ?? '').split(' ');
      expect(document.getElementById(label!)?.textContent).toBe('Deep reasoning');
    });
  });
});

describe('describeDefault', () => {
  const models = [{ key: 'opus', display_name: 'Opus', provider: 'anthropic', id: 'opus-id' }];
  const names: Record<string, string> = { dev: 'DevAgent', analyst: 'Analyst' };
  const nameOf = ({ entity }: { entity: string }) => names[entity] ?? entity;
  const sourceOf = (...sources: (string | undefined)[]) =>
    describeDefault(
      sources.map((source, index) => ({
        entity: `agent${index}`,
        model: 'opus',
        ...(source ? { source: source as 'agent' } : {}),
      })),
      models,
      nameOf
    ).source;

  it.each([
    [['agent'], 'agent'],
    [['agent', 'agent'], 'agent'],
    [['room', 'room'], 'room'],
    [['room_config'], 'room'],
    [['agent', 'room_config'], 'unknown'],
    [['agent', undefined], 'unknown'],
    [[undefined], 'unknown'],
    [[], 'unknown'],
  ])('names %j as %s', (sources, expected) => {
    expect(sourceOf(...sources)).toBe(expected);
  });

  it("lists each agent's display name with its model, one agent as a pair", () => {
    expect(
      describeDefault([{ entity: 'dev', model: 'opus', source: 'agent' }], models, nameOf)
    ).toEqual({ source: 'agent', agents: 'DevAgent · Opus', roomOverride: false });
    expect(
      describeDefault(
        [
          { entity: 'dev', model: 'opus', source: 'room' },
          { entity: 'analyst', model: 'sol', source: 'room' },
        ],
        models,
        nameOf
      )
    ).toEqual({ source: 'room', agents: 'DevAgent: Opus · Analyst: sol', roomOverride: true });
  });

  it("says !room_model set the model only when it set every agent's", () => {
    const roomOverride = (...sources: ('room' | 'room_config' | 'agent')[]) =>
      describeDefault(
        sources.map((source) => ({ entity: 'dev', model: 'opus', source })),
        models,
        nameOf
      ).roomOverride;
    expect(roomOverride('room', 'room')).toBe(true);
    expect(roomOverride('room', 'room_config')).toBe(false);
    expect(roomOverride('room', 'agent')).toBe(false);
    expect(roomOverride()).toBe(false);
  });
});

describe('TrappedModelPickerPanel', () => {
  it('takes a dialog label and, for a room setting, writes the current choice again', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panelRoot = createRoot(host);
    const state = createState({ override: null, canMutate: true });
    const onCommand = vi.fn();
    try {
      act(() =>
        panelRoot.render(
          <TrappedModelPickerPanel
            state={state}
            defaults={{
              label: 'Use configured default',
              agents: '',
              description: 'Follow default.',
            }}
            room="50vh"
            ariaLabel="Model"
            roomSetting={{ canReset: true }}
            requestClose={vi.fn()}
            onCommand={onCommand}
          />
        )
      );
      const dialog = host.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-label')).toBe('Model');
      const defaultOption = host.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]'
      );
      expect(defaultOption?.textContent).toContain('Use configured default');
      act(() => {
        defaultOption?.click();
      });
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(state.resetToRoomDefault).toHaveBeenCalledTimes(1);

      // Picking the default level of a plain-key model still closes without pinning key@level.
      const requestClose = vi.fn();
      const levelState = createState({
        models: [
          {
            key: 'deep',
            display_name: 'Deep',
            provider: 'acme',
            id: 'deep-1',
            reasoning_levels: ['low', 'medium', 'high'],
            reasoning_default: 'medium',
          },
        ],
        override: 'deep',
        reasoning: null,
        canMutate: true,
      });
      act(() =>
        panelRoot.render(
          <TrappedModelPickerPanel
            state={levelState}
            defaults={{
              label: 'Use configured default',
              agents: '',
              description: 'Follow default.',
            }}
            room="50vh"
            ariaLabel="Model"
            roomSetting={{ canReset: true }}
            requestClose={requestClose}
            onCommand={onCommand}
          />
        )
      );
      const defaultRadio = host.querySelector<HTMLElement>('[role="radio"][data-level="medium"]');
      act(() => {
        defaultRadio?.click();
      });
      expect(levelState.selectModel).not.toHaveBeenCalled();
      expect(requestClose).toHaveBeenCalledTimes(1);
    } finally {
      act(() => panelRoot.unmount());
      host.remove();
    }
  });
});

describe('ModelPicker inline provider usage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let currentPathname = '';

  function LocationObserver() {
    currentPathname = useLocation().pathname;
    return null;
  }

  beforeEach(() => {
    currentPathname = '';
    mocks.ensureUsageLoaded.mockReset();
    mocks.usage.available = false;
    mocks.usage.runtimes = [];
    mocks.usage.snapshotsByRuntime = {};
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('triggers ensureLoaded(roomId), shows visual meter & accessible quotas strictly for state.runtime, and omits ambiguous groups', async () => {
    const snapshot = JSON.parse(JSON.stringify(contractFixture)) as ProviderUsageSnapshot;
    const runtimeKey = `${runtime.userId}:${runtime.deviceId}`;
    mocks.usage.available = true;
    mocks.usage.runtimes = [{ ...runtime, id: runtimeKey }];
    mocks.usage.snapshotsByRuntime = { [runtimeKey]: snapshot };

    const room = { roomId: '!room:example.org', getMember: () => undefined } as unknown as Room;
    const state = createState({
      models: [
        { key: 'opus_native', display_name: 'Opus', provider: 'Claude Code', id: 'claude-opus' },
        {
          key: 'sonnet_native',
          display_name: 'Sonnet',
          provider: 'Claude Code',
          id: 'claude-sonnet',
        },
        { key: 'neon', display_name: 'Neon', provider: 'OpenRouter', id: 'google/gemini-neon' },
        { key: 'haiku', display_name: 'Haiku', provider: 'Mixed', id: 'claude-haiku' },
        { key: 'astra', display_name: 'Astra', provider: 'Mixed', id: 'gpt-astra' },
      ],
    });

    act(() =>
      root.render(
        <MemoryRouter initialEntries={['/home/']}>
          <LocationObserver />
          <ModelPicker state={state} room={room} />
        </MemoryRouter>
      )
    );
    await click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(mocks.ensureUsageLoaded).toHaveBeenCalledWith('!room:example.org');

    const claudeGroup = container.querySelector('[role="group"][aria-label="Claude Code"]')!;
    const claudeQuota = claudeGroup.querySelector('[data-inline-quota="claude_code:default"]')!;
    expect(claudeQuota.textContent).toBe('5h 62%·7d 78%');
    expect(claudeQuota.querySelector('[data-inline-quota-bar]')).not.toBeNull();
    // Accessible to screen readers: NOT inside aria-hidden and wired via aria-describedby, with 0 tab stops.
    expect(claudeQuota.closest('[aria-hidden="true"]')).toBeNull();
    expect(claudeQuota.getAttribute('role')).toBe('img');
    expect(claudeQuota.getAttribute('aria-label')).toContain('62% remaining');
    expect(claudeGroup.getAttribute('aria-describedby')).toBe(claudeQuota.getAttribute('id'));
    expect(claudeQuota.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);

    const openRouterGroup = container.querySelector('[role="group"][aria-label="OpenRouter"]')!;
    expect(openRouterGroup.querySelector('[data-inline-quota="openrouter:1"]')?.textContent).toBe(
      '63% left'
    );

    const mixedGroup = container.querySelector('[role="group"][aria-label="Mixed"]')!;
    expect(mixedGroup.querySelector('[data-inline-quota]')).toBeNull();

    const footerButton = container.querySelector('[data-usage-footer] button') as HTMLButtonElement;
    expect(footerButton).not.toBeNull();
    expect(footerButton.textContent).toContain('All usage & limits');
    await click(footerButton);
    expect(currentPathname).toBe('/usage/');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('never shows another runtime quota when state.runtime has no snapshot', async () => {
    const snapshot = JSON.parse(JSON.stringify(contractFixture)) as ProviderUsageSnapshot;
    const otherRuntime = {
      id: '@other:example.org:OTHER',
      userId: '@other:example.org',
      deviceId: 'OTHER',
      curveKey: 'other-curve',
    };
    mocks.usage.available = true;
    mocks.usage.runtimes = [otherRuntime];
    mocks.usage.snapshotsByRuntime = { [otherRuntime.id]: snapshot };

    const state = createState({
      runtime,
      models: [
        { key: 'opus_native', display_name: 'Opus', provider: 'Claude Code', id: 'claude-opus' },
      ],
    });
    act(() =>
      root.render(
        <MemoryRouter initialEntries={['/home/']}>
          <ModelPicker state={state} />
        </MemoryRouter>
      )
    );
    await click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.querySelector('[data-inline-quota]')).toBeNull();
    // Footer remains available so the user can still jump to /usage/ and switch runtimes.
    expect(container.querySelector('[data-usage-footer]')).not.toBeNull();
  });

  it('hides inline quotas and the footer link when provider usage is unavailable', async () => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={['/home/']}>
          <ModelPicker state={createState()} />
        </MemoryRouter>
      )
    );
    await click(container.querySelector('button[aria-label="Choose model"]')!);

    expect(container.querySelector('[data-inline-quota]')).toBeNull();
    expect(container.querySelector('[data-usage-footer]')).toBeNull();
  });

  it('renders without throwing outside a Router and omits the usage footer link', async () => {
    const snapshot = JSON.parse(JSON.stringify(contractFixture)) as ProviderUsageSnapshot;
    const runtimeKey = `${runtime.userId}:${runtime.deviceId}`;
    mocks.usage.available = true;
    mocks.usage.runtimes = [{ ...runtime, id: runtimeKey }];
    mocks.usage.snapshotsByRuntime = { [runtimeKey]: snapshot };

    const state = createState({
      models: [
        { key: 'opus_native', display_name: 'Opus', provider: 'Claude Code', id: 'claude-opus' },
      ],
    });

    act(() => root.render(<ModelPicker state={state} />));
    const triggerButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose model"]'
    );
    expect(triggerButton).not.toBeNull();

    await click(triggerButton!);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-inline-quota="claude_code:default"]')).not.toBeNull();
    expect(container.querySelector('[data-usage-footer]')).toBeNull();
  });
});
