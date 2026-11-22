// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPickerState } from '../../../models/useModelPicker';
import { RoomMindroomPage } from './RoomMindroomPage';

const ROOM = { roomId: '!room:example.test' } as Room;

const mocks = vi.hoisted(() => ({
  useModelPicker: vi.fn(),
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
  useModelPicker: (...args: unknown[]) => {
    mocks.useModelPicker(...args);
    return CATALOG;
  },
}));
vi.mock('../../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main aria-label={title}>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('../../../ui/settings/SettingsSection', () => ({
  SettingsSection: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section aria-label={title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
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
  mocks.useModelPicker.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('RoomMindroomPage', () => {
  it('groups settings into Agents and Thread titles and shares one room-scope model catalog', () => {
    render(<RoomMindroomPage room={ROOM} requestClose={vi.fn()} />);

    expect(mocks.useModelPicker).toHaveBeenCalledTimes(1);
    expect(mocks.useModelPicker).toHaveBeenCalledWith(ROOM, undefined);

    const agents = screen.getByRole('region', { name: 'Agents' });
    const agentKeys = [...agents.querySelectorAll('[data-testid^="tile-"]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(agentKeys).toEqual(['tile-model', 'tile-reply_mode', 'tile-thread_mode']);
    expect(within(agents).getByTestId('tile-model').getAttribute('data-levels')).toBe('true');
    expect(within(agents).getByTestId('tile-model').getAttribute('data-shared-catalog')).toBe(
      'true'
    );

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
