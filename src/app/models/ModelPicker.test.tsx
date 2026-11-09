// @vitest-environment jsdom

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogEntry } from './modelProtocol';
import type { ModelPickerState } from './useModelPicker';
import { ModelPicker, ThreadModelPicker } from './ModelPicker';
import { ModelIcon } from './ModelIcon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  useModelPicker: vi.fn(),
  mxcUrlToHttp: vi.fn(() => 'https://matrix.example/media/icon'),
}));

vi.mock('./ModelPicker.css', () => ({
  Check: 'Check',
  Controls: 'Controls',
  Empty: 'Empty',
  Error: 'Error',
  ErrorActions: 'ErrorActions',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  IconImage: 'IconImage',
  Option: 'Option',
  OptionDetail: 'OptionDetail',
  OptionIcon: 'OptionIcon',
  OptionText: 'OptionText',
  OptionTitle: 'OptionTitle',
  Panel: 'Panel',
  Results: 'Results',
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
  TriggerIcon: 'TriggerIcon',
  VisuallyHidden: 'VisuallyHidden',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        'mindroomUi.models.modelPicker.chooseModel': 'Choose model',
        'mindroomUi.models.modelPicker.roomDefault': 'Room default',
        'mindroomUi.models.modelPicker.modelForThread': 'Model for this thread',
        'mindroomUi.models.modelPicker.search': 'Search models',
        'mindroomUi.models.modelPicker.roomDefaultDescription':
          'Let each agent use its configured model.',
        'mindroomUi.models.modelPicker.models': 'Models',
        'mindroomUi.models.modelPicker.runtime': 'Runtime',
        'mindroomUi.models.modelPicker.chooseRuntime': 'Choose a runtime',
        'mindroomUi.models.modelPicker.retry': 'Retry',
        'mindroomUi.models.modelPicker.loading': 'Loading models',
        'mindroomUi.models.modelPicker.pending': 'Waiting for model change',
        'mindroomUi.models.modelPicker.noResults': 'No matching models',
        'mindroomUi.models.modelPicker.commandFallback':
          'You can still send !model with a model key in this thread.',
        'mindroomUi.models.modelPicker.runtimeLabel': `${String(options?.userId)} on ${String(
          options?.deviceId
        )}`,
      };
      return strings[key] ?? key;
    },
  }),
}));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PopOut: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
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
  inherited: [{ entity: 'assistant', model: 'fast' }],
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

const click = (element: Element) => {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const input = (element: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const keyDown = (element: Element, key: string) => {
  act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
};

describe('composer model picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  const trigger = () => container.querySelector('button[aria-label="Choose model"]')!;
  const list = () => container.querySelector('[role="listbox"]');
  const search = () => container.querySelector('input[role="searchbox"]') as HTMLInputElement;
  const options = () => [...container.querySelectorAll('[role="option"]')];
  const optionNamed = (text: string) => options().find((row) => row.textContent?.includes(text))!;
  const open = (state: ModelPickerState) => {
    act(() => root.render(<ModelPicker state={state} />));
    click(trigger());
  };

  beforeEach(() => {
    mocks.useModelPicker.mockReset();
    mocks.mxcUrlToHttp.mockClear();
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

  it('opens a glass menu named for the thread, with no filter field for a short catalog', () => {
    open(createState());

    const menu = container.querySelector('[role="dialog"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Model for this thread');
    expect(menu.hasAttribute('data-glass-menu')).toBe(true);
    expect(search()).toBeNull();
    expect(list()).toBe(document.activeElement);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('lists each model by name over its model ID, under its provider, and checks the current one', () => {
    open(createState({ override: 'reset' }));

    const reasoning = optionNamed('Deep reasoning');
    expect(reasoning.querySelector('.OptionDetail')?.textContent).toBe('reasoning-model');
    expect(reasoning.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Anthropic');
    expect(reasoning.getAttribute('aria-selected')).toBe('true');
    expect(reasoning.querySelector('.Check')).not.toBeNull();
    expect(optionNamed('Quick helper').querySelector('.Check')).toBeNull();
  });

  it('says under "Room default" which model each agent falls back to', () => {
    open(
      createState({
        override: 'reset',
        inherited: [
          { entity: 'assistant', model: 'fast' },
          { entity: 'reviewer', model: 'legacy-key' },
        ],
      })
    );

    expect(optionNamed('Room default').querySelector('.OptionDetail')?.textContent).toBe(
      'assistant: Quick helper, reviewer: legacy-key'
    );
  });

  it('explains "Room default" before the router names the fallback models', () => {
    open(createState({ inherited: [] }));

    expect(optionNamed('Room default').querySelector('.OptionDetail')?.textContent).toBe(
      'Let each agent use its configured model.'
    );
  });

  it('starts on the current model, so Enter keeps it', () => {
    const state = createState({ override: 'reset' });
    open(state);

    keyDown(list()!, 'Enter');

    expect(state.selectModel).toHaveBeenCalledWith('reset');
  });

  it('supports arrow selection, Enter, and Escape from the list', () => {
    const state = createState();
    open(state);

    keyDown(list()!, 'ArrowDown');
    keyDown(list()!, 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('fast');

    keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('keeps room reset distinct from selecting a model whose stable key is default', () => {
    const state = createState({ override: 'default' });
    open(state);

    const defaultAction = optionNamed('Room default');
    const namedDefault = optionNamed('Named default');

    expect(defaultAction.getAttribute('aria-selected')).toBe('false');
    expect(namedDefault.getAttribute('aria-selected')).toBe('true');

    click(namedDefault);
    expect(state.selectModel).toHaveBeenCalledWith('default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();

    click(defaultAction);
    expect(state.resetToRoomDefault).toHaveBeenCalledOnce();
  });

  it('sets a configured model whose key matches the room-default DOM identity', () => {
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
    open(state);

    click(optionNamed('Configured fallback'));

    expect(state.selectModel).toHaveBeenCalledWith('room-default');
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
  });

  it('moves through options in the same order as interleaved provider groups render', () => {
    const state = createState({
      models: [
        { key: 'a', display_name: 'Alpha', provider: 'OpenAI', id: 'a-model' },
        { key: 'b', display_name: 'Beta', provider: 'Anthropic', id: 'b-model' },
        { key: 'c', display_name: 'Charlie', provider: 'OpenAI', id: 'c-model' },
      ],
    });
    open(state);

    const rendered = options().map((option) => option.textContent);
    expect(rendered[1]).toContain('Alpha');
    expect(rendered[2]).toContain('Charlie');

    keyDown(list()!, 'ArrowDown');
    keyDown(list()!, 'ArrowDown');
    keyDown(list()!, 'Enter');

    expect(state.selectModel).toHaveBeenCalledWith('c');
  });

  it('adds a filter field past eight models, matching name, key, provider and model ID', () => {
    open(createState({ models: longCatalog() }));

    expect(search()).toBe(document.activeElement);
    expect(search().getAttribute('placeholder')).toBe('Search models');
    expect(list()?.getAttribute('tabindex')).toBe('-1');

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

  it('picks the first match with Enter and moves with the arrows from the filter field', () => {
    const state = createState({ models: longCatalog() });
    open(state);

    input(search(), 'studio');
    expect(search().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    keyDown(search(), 'ArrowDown');
    expect(search().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    keyDown(search(), 'ArrowUp');
    keyDown(search(), 'Enter');
    expect(state.selectModel).toHaveBeenCalledWith('studio-1');

    keyDown(search(), 'Escape');
    expect(search()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('shows an explicit readable chooser when multiple runtimes answer', () => {
    const secondRuntime = {
      ...runtime,
      id: 'runtime-two',
      userId: '@second-runtime:example.org',
      deviceId: 'MOBILE',
    };
    const state = createState({
      runtimes: [runtime, secondRuntime],
      runtime: undefined,
      canMutate: false,
      models: [],
    });
    open(state);

    const chooser = container.querySelector('select[aria-label="Runtime"]') as HTMLSelectElement;
    expect(chooser.textContent).toContain('@runtime:example.org on DESKTOP');
    expect(chooser.textContent).toContain('@second-runtime:example.org on MOBILE');

    act(() => {
      chooser.value = 'runtime-two';
      chooser.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.chooseRuntime).toHaveBeenCalledWith('runtime-two');
  });

  it('refreshes on opening and keeps dismissal available while a command is pending', () => {
    const state = createState({ pending: true, loading: true, canMutate: false });
    open(state);

    expect(state.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Waiting for model change'
    );
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(options()[0]?.getAttribute('aria-disabled')).toBe('true');

    keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
  });

  it('uses controller availability for model and reset activation while recovery is blocked', () => {
    const state = createState({
      canMutate: false,
      pending: false,
      loading: false,
      error: 'Recovery unavailable.',
    });
    open(state);
    expect(options().every((option) => option.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    options().forEach(click);
    keyDown(list()!, 'Enter');
    keyDown(list()!, 'ArrowDown');
    keyDown(list()!, 'Enter');
    expect(state.selectModel).not.toHaveBeenCalled();
    expect(state.resetToRoomDefault).not.toHaveBeenCalled();
    click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    keyDown(list()!, 'Escape');
    expect(list()).toBeNull();
    click(trigger());
    act(() => root.render(<ModelPicker state={{ ...state, canMutate: true }} />));
    expect(options().every((option) => option.getAttribute('aria-disabled') === 'false')).toBe(
      true
    );
    keyDown(list()!, 'Enter');
    keyDown(list()!, 'ArrowDown');
    keyDown(list()!, 'Enter');
    expect(state.resetToRoomDefault).toHaveBeenCalledOnce();
    expect(state.selectModel).toHaveBeenCalledWith('fast');
  });

  it('keeps an error open with retry and readable command fallback', () => {
    const state = createState({ error: 'Model discovery unavailable.' });
    open(state);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Model discovery unavailable.'
    );
    expect(container.textContent).toContain('You can still send !model with a model key');
    click(container.querySelector('button[aria-label="Retry"]')!);
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });

  it('closes once the router applies the chosen model', () => {
    const state = createState();
    open(state);
    click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    expect(list()).not.toBeNull();
    act(() => root.render(<ModelPicker state={{ ...state, override: 'fast' }} />));

    expect(list()).toBeNull();
    expect(trigger()).toBe(document.activeElement);
  });

  it('does not steal focus when a dismissed pending command later succeeds', () => {
    const state = createState();
    const outside = document.createElement('input');
    document.body.append(outside);
    open(state);
    click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    keyDown(list()!, 'Escape');
    outside.focus();
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(document.activeElement).toBe(outside);
  });

  it('does not let a command acknowledged while dismissed close a later opening', () => {
    const state = createState();
    open(state);
    click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    keyDown(list()!, 'Escape');
    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));
    click(trigger());

    expect(list()).not.toBeNull();
  });

  it('does not let a dismissed command close a reopening when its acknowledgement arrives', () => {
    const state = createState();
    open(state);
    click(optionNamed('Quick helper'));

    act(() => root.render(<ModelPicker state={{ ...state, pending: true, canMutate: false }} />));
    keyDown(list()!, 'Escape');
    click(trigger());
    expect(list()).not.toBeNull();

    act(() => root.render(<ModelPicker state={{ ...state, pending: false }} />));

    expect(list()).not.toBeNull();
  });

  it('closes as the conversation it is in hides', () => {
    const state = createState();
    open(state);
    expect(list()).not.toBeNull();

    act(() => root.render(<ModelPicker state={state} conversationHidden />));

    expect(list()).toBeNull();
  });

  it('loads custom icons through authenticated Matrix media and falls back on image error', () => {
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

    act(() => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
