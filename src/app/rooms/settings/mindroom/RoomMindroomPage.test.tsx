// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { RoomMindroomPage } from './RoomMindroomPage';

const ROOM = { roomId: '!room:example.test' } as Room;

const mocks = vi.hoisted(() => ({
  useRoomModelCatalog: vi.fn(),
}));

const CATALOG: ModelPickerState = {
  eligible: false,
  runtimes: [],
  models: [],
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
};

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../../../models/useModelPicker', () => ({
  useRoomModelCatalog: (...args: unknown[]) => {
    mocks.useRoomModelCatalog(...args);
    return CATALOG;
  },
}));
vi.mock('../../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main aria-label={title}>
      <h2>{title}</h2>
      {children}
    </main>
  ),
}));
vi.mock('../../../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./RoomModelSettingTile', () => ({
  RoomModelSettingTile: ({
    definition,
    catalog,
  }: {
    definition: { key: string; allowReasoningLevels: boolean };
    catalog: ModelPickerState;
  }) => (
    <div
      data-testid={`tile-${definition.key}`}
      data-kind="model"
      data-levels={String(definition.allowReasoningLevels)}
      data-shared-catalog={String(catalog === CATALOG)}
    />
  ),
}));
vi.mock('./RoomChoiceSettingTile', () => ({
  RoomChoiceSettingTile: ({ definition }: { definition: { key: string } }) => (
    <div data-testid={`tile-${definition.key}`} data-kind="choice" />
  ),
}));
vi.mock('./RoomTextSettingTile', () => ({
  RoomTextSettingTile: ({ definition }: { definition: { key: string } }) => (
    <div data-testid={`tile-${definition.key}`} data-kind="text" />
  ),
}));

beforeEach(() => {
  mocks.useRoomModelCatalog.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('RoomMindroomPage', () => {
  it('groups settings into Agents and Thread titles sections with real headings and shares one catalog', () => {
    render(<RoomMindroomPage room={ROOM} requestClose={vi.fn()} />);

    expect(mocks.useRoomModelCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.useRoomModelCatalog).toHaveBeenCalledWith(ROOM);

    expect(screen.getByRole('heading', { name: 'Agents', level: 3 })).toBeTruthy();
    const agents = screen.getByRole('region', { name: 'Agents' });
    const agentKeys = [...agents.querySelectorAll('[data-testid^="tile-"]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(agentKeys).toEqual(['tile-model', 'tile-reply_mode', 'tile-thread_mode']);
    expect(within(agents).getByTestId('tile-model').getAttribute('data-levels')).toBe('true');
    expect(within(agents).getByTestId('tile-model').getAttribute('data-shared-catalog')).toBe(
      'true'
    );

    expect(screen.getByRole('heading', { name: 'Thread titles', level: 3 })).toBeTruthy();
    const titles = screen.getByRole('region', { name: 'Thread titles' });
    const titleKeys = [...titles.querySelectorAll('[data-testid^="tile-"]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(titleKeys).toEqual(['tile-thread_summary_instructions', 'tile-thread_summary_model']);
    expect(
      within(titles).getByTestId('tile-thread_summary_model').getAttribute('data-levels')
    ).toBe('false');
    expect(
      within(titles).getByTestId('tile-thread_summary_model').getAttribute('data-shared-catalog')
    ).toBe('true');
  });
});
