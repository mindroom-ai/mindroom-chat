// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogEntry } from '../models/modelProtocol';
import type { ModelChange } from './modelChanges';
import { ModelChangeMarker } from './ModelChangeMarker';

const VIEWER = '@sam:example.org';
const catalog = vi.hoisted(() => ({ models: [] as ModelCatalogEntry[], watched: [] as unknown[] }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn, i18n: { language: 'en' } }) };
});
vi.mock('./ModelChangeMarker.css', () => ({
  Marker: 'Marker',
  Trigger: 'Trigger',
  Title: 'Title',
  Model: 'Model',
  Panel: 'Panel',
}));
vi.mock('./Time.css', () => ({}));
vi.mock('@tabler/icons-react', () => ({ IconArrowsExchange: () => <svg /> }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => VIEWER }),
}));
vi.mock('../models/useModelPicker', () => ({
  useThreadModelCatalog: (...scope: unknown[]) => {
    catalog.watched = scope;
    return catalog.models;
  },
}));
vi.mock('../matrix/room', () => ({
  getMemberDisplayName: (_room: Room, userId: string) =>
    ({ '@sam:example.org': 'Sam', '@jo:example.org': 'Jo' }[userId]),
}));
vi.mock('../preferences/useHour24Clock', () => ({ useHour24Clock: () => [true, () => {}] }));
vi.mock('../preferences/useSettingValue', () => ({ useSettingValue: () => 'D MMM YYYY' }));

const QUICK: ModelCatalogEntry = {
  key: 'fast',
  display_name: 'Quick helper',
  provider: 'openai',
  id: 'model',
  reasoning_levels: ['low', 'high'],
  reasoning_default: 'low',
};

const room = { roomId: '!room:example.org' } as unknown as Room;

const change = (changes: Partial<ModelChange> = {}): ModelChange => ({
  commandId: '$command',
  operation: 'set',
  model: 'fast',
  senderId: VIEWER,
  threadId: '$root',
  ...changes,
});

// Midday, so the local day is the same in any time zone the tests run in.
const TS = Date.UTC(2026, 0, 15, 12, 0);

const show = (shown: ModelChange, models: ModelCatalogEntry[] = [QUICK]) => {
  catalog.models = models;
  return render(<ModelChangeMarker change={shown} room={room} ts={TS} />);
};

afterEach(cleanup);

describe('ModelChangeMarker', () => {
  it("names the model a set chose by the name the viewer's catalog gives its key", () => {
    show(change());
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('Model setQuick helper');
    expect(catalog.watched).toEqual([room, '$root']);
  });

  it('adds the level a set named', () => {
    show(change({ model: 'fast@high' }));
    expect(screen.getByRole('button').textContent).toBe('Model setQuick helper · High');
  });

  it.each([
    ['the viewer has no catalog', [] as ModelCatalogEntry[], 'fast@high', 'fast · High'],
    ['the catalog does not hold the key', [QUICK], 'slow', 'slow'],
    ['the level is not one the client knows', [QUICK], 'fast@turbo', 'fast@turbo'],
  ])('falls back to the key when %s', (_case, models, model, label) => {
    show(change({ model }), models);
    expect(screen.getByRole('button').textContent).toBe(`Model set${label}`);
  });

  it('says a reset went back to the inherited models, and names none', () => {
    show(change({ operation: 'reset', model: undefined }));
    expect(screen.getByRole('button').textContent).toBe('Model resetBack to inherited models');
  });

  it('opens and closes its details in place', () => {
    show(change());
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Applies to future replies/)).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel?.textContent).toContain('Changed by Sam');
    expect(panel?.querySelector('time')?.getAttribute('datetime')).toBe(new Date(TS).toISOString());
    expect(panel?.textContent).toContain(
      'Applies to future replies in this thread from the agents and teams you may address.'
    );

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Applies to future replies/)).toBeNull();
  });

  it("speaks of the sender's agents when someone else changed the model", () => {
    show(change({ senderId: '@jo:example.org' }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Changed by Jo/)).toBeTruthy();
    expect(
      screen.getByText(
        'Applies to future replies in this thread from the agents and teams Jo may address.'
      )
    ).toBeTruthy();
  });

  it('names a sender who is not a member by their Matrix ID', () => {
    show(change({ senderId: '@gone:example.org' }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Changed by @gone:example.org/)).toBeTruthy();
  });
});
