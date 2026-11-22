// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

/** The tiles of the card under the title `name`, as `key levels shared-catalog`. */
const tilesUnder = (name: string) =>
  [
    ...screen
      .getByText(name)
      .parentElement!.querySelectorAll<HTMLElement>('[data-testid^="tile-"]'),
  ].map(({ dataset }) =>
    [dataset.testid, dataset.levels, dataset.sharedCatalog].filter(Boolean).join(' ')
  );

describe('RoomMindroomPage', () => {
  it('groups the settings under the titles Agents and Thread titles and shares one catalog', () => {
    render(<RoomMindroomPage room={ROOM} requestClose={vi.fn()} />);

    expect(mocks.useRoomModelCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.useRoomModelCatalog).toHaveBeenCalledWith(ROOM);
    expect(tilesUnder('Agents')).toEqual([
      'tile-model true true',
      'tile-reply_mode',
      'tile-thread_mode',
    ]);
    expect(tilesUnder('Thread titles')).toEqual([
      'tile-thread_summary_instructions',
      'tile-thread_summary_model false true',
    ]);
  });
});
