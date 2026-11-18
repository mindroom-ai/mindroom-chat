import { describe, expect, it } from 'vitest';
import { parseModelCatalogResponse, parseModelSelectionResult } from './modelProtocol';

const catalog = {
  version: 1,
  request_id: 'r',
  room_id: '!room:test',
  thread_id: '$root',
  capabilities: ['model_selection'],
  agent_user_ids: ['@mindroom_helper:test'],
  catalog_revision: 'revision',
  models: [
    { key: 'fast', display_name: 'Same', provider: 'openai', id: 'model' },
    { key: 'reset', display_name: 'Same', provider: 'openai', id: 'model' },
  ],
  selection: { override: null, inherited: [{ entity: 'helper', model: 'fast' }] },
};

describe('model catalog wire validation', () => {
  it('keeps stable keys with duplicate labels', () => {
    expect(parseModelCatalogResponse(catalog)?.models.map((m) => m.key)).toEqual(['fast', 'reset']);
  });
  it.each([
    { version: 2 },
    { request_id: '' },
    { thread_id: null },
    { models: Array(257).fill(catalog.models[0]) },
    { catalog_revision: 'x'.repeat(65536) },
    { selection: { inherited: [] } },
    { models: [{ ...catalog.models[0], icon_url: 'https://example.org/logo' }] },
    { models: [catalog.models[0], catalog.models[0]] },
  ])('rejects malformed response %j', (change) => {
    expect(parseModelCatalogResponse({ ...catalog, ...change })).toBeUndefined();
  });
  it('falls back to key and accepts Matrix media', () => {
    expect(
      parseModelCatalogResponse({
        ...catalog,
        models: [{ key: 'fast', provider: 'openai', id: 'm', icon_url: 'mxc://test/image' }],
      })?.models[0]
    ).toEqual({
      key: 'fast',
      display_name: 'fast',
      provider: 'openai',
      id: 'm',
      icon_url: 'mxc://test/image',
    });
  });
});

describe('reasoning levels on the wire', () => {
  const sol = {
    key: 'sol',
    display_name: 'Sol',
    provider: 'codex',
    id: 'gpt-sol',
    reasoning_levels: ['low', 'medium', 'high', 'xhigh'],
    reasoning_default: 'high',
  };
  const withSol = (selection: object, model: object = sol) => ({
    ...catalog,
    models: [catalog.models[0], model],
    selection,
  });

  it("keeps a model's levels, its default and the levels of the selection", () => {
    const parsed = parseModelCatalogResponse(
      withSol({
        override: 'sol',
        reasoning: 'xhigh',
        inherited: [
          { entity: 'helper', model: 'sol', reasoning: 'low' },
          { entity: 'scout', model: 'fast' },
        ],
      })
    );
    expect(parsed?.models[1]).toEqual(sol);
    expect(parsed?.models[0]).not.toHaveProperty('reasoning_levels');
    expect(parsed?.selection).toEqual({
      override: 'sol',
      reasoning: 'xhigh',
      inherited: [
        { entity: 'helper', model: 'sol', reasoning: 'low' },
        { entity: 'scout', model: 'fast' },
      ],
    });
  });

  it('reads an answer without levels, as an older backend sends, as before', () => {
    const parsed = parseModelCatalogResponse(catalog);
    expect(parsed?.models.every((m) => !('reasoning_levels' in m))).toBe(true);
    expect(parsed?.selection).toEqual(catalog.selection);
  });

  it('keeps a known source on each inherited model and drops an unknown one', () => {
    const parsed = parseModelCatalogResponse({
      ...catalog,
      selection: {
        override: null,
        inherited: [
          { entity: 'helper', model: 'fast', source: 'room_config' },
          { entity: 'scout', model: 'fast', source: 'space' },
          { entity: 'crew', model: 'fast', source: 7 },
        ],
      },
    });
    expect(parsed?.selection.inherited).toEqual([
      { entity: 'helper', model: 'fast', source: 'room_config' },
      { entity: 'scout', model: 'fast' },
      { entity: 'crew', model: 'fast' },
    ]);
  });

  it.each([
    { reasoning_levels: 'high' },
    { reasoning_levels: [] },
    { reasoning_levels: ['low', 'turbo'] },
    { reasoning_levels: ['low', 'low'] },
    { reasoning_levels: Array(9).fill('low') },
    { reasoning_default: 'max' },
    { reasoning_default: undefined },
  ])('drops malformed levels %j but keeps the model', (change) => {
    const parsed = parseModelCatalogResponse(
      withSol({ override: 'sol', reasoning: 'high', inherited: [] }, { ...sol, ...change })
    );
    expect(parsed?.models[1]).toEqual({
      key: 'sol',
      display_name: 'Sol',
      provider: 'codex',
      id: 'gpt-sol',
    });
    expect(parsed?.selection).toEqual({ override: 'sol', inherited: [] });
  });

  it('drops a selected level its model does not offer', () => {
    const parsed = parseModelCatalogResponse(
      withSol({
        override: 'fast',
        reasoning: 'high',
        inherited: [{ entity: 'helper', model: 'sol', reasoning: 'max' }],
      })
    );
    expect(parsed?.selection).toEqual({
      override: 'fast',
      inherited: [{ entity: 'helper', model: 'sol' }],
    });
  });
});

describe('selection result wire validation', () => {
  const result = {
    version: 1,
    command_event_id: '$command',
    room_id: '!room:test',
    thread_id: '$root',
    runtime_user_id: '@mindroom_router:test',
    runtime_device_id: 'DEVICE',
    operation: 'set',
    model: 'reset',
    status: 'applied',
    override: 'reset',
  };
  it('distinguishes set reset from reset operation', () => {
    expect(parseModelSelectionResult(result)?.override).toBe('reset');
    expect(parseModelSelectionResult({ ...result, operation: 'reset' })).toBeUndefined();
  });
  it('accepts a set of a model at a level that echoes the reference', () => {
    expect(
      parseModelSelectionResult({ ...result, model: 'sol@high', override: 'sol@high' })?.override
    ).toBe('sol@high');
  });
  it.each([{ runtime_device_id: '' }, { override: null }, { status: 'rejected' }, { version: 2 }])(
    'rejects inconsistent result %j',
    (change) => {
      expect(parseModelSelectionResult({ ...result, ...change })).toBeUndefined();
    }
  );
});
