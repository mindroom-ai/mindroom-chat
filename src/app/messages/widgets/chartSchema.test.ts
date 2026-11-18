import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/ui-widgets-v1.json';
import { parseChartWidget } from './chartSchema';

type WidgetCase = {
  name: string;
  stage: number;
  json: string;
  valid?: boolean;
  canonical?: string;
};
const stage1 = (fixture.widgets as WidgetCase[]).filter((c) => c.stage === 1);
const valid = stage1.filter((c): c is WidgetCase & { canonical: string } => !!c.valid);

describe('parseChartWidget', () => {
  it.each(valid.map((c) => [c.name, c] as const))('accepts the wire text: %s', (_n, c) => {
    const chart = parseChartWidget(c.canonical);
    expect(chart?.labels.every((label) => typeof label === 'string')).toBe(true);
    expect(chart?.series.every((s) => s.data.every(Number.isFinite))).toBe(true);
  });

  it.each(stage1.filter((c) => !c.valid).map((c) => [c.name, c] as const))(
    'rejects: %s',
    (_n, c) => {
      expect(parseChartWidget(c.json)).toBeUndefined();
    }
  );

  it.each((fixture.wire_invalid as WidgetCase[]).map((c) => [c.name, c] as const))(
    'rejects what only the wire could carry: %s',
    (_n, c) => {
      expect(parseChartWidget(c.json)).toBeUndefined();
    }
  );

  it('reads the section 5.2 entry', () => {
    const json =
      '{"kind":"line","labels":["Jan","Feb","Mar"],"series":[{"data":[120,180.5,150],"name":"Signups"}],"title":"Signups","type":"chart","y":"users"}';
    expect(parseChartWidget(json)).toEqual({
      type: 'chart',
      kind: 'line',
      title: 'Signups',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [{ name: 'Signups', data: [120, 180.5, 150] }],
      y: 'users',
    });
  });

  it('rejects a lone surrogate and keeps a surrogate pair', () => {
    const chart = (title: string) =>
      `{"kind":"bar","labels":["Q1"],"series":[{"data":[1],"name":"S"}],"title":${title},"type":"chart"}`;
    expect(parseChartWidget(chart('"\\ud83dx"'))).toBeUndefined();
    expect(parseChartWidget(chart('"\\ud83d\\ude00"'))?.title).toBe('\u{1F600}');
  });

  it('never throws on text that is not JSON', () => {
    expect(parseChartWidget('{"type":')).toBeUndefined();
  });
});
