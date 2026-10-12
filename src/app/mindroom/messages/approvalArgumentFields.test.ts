import { describe, expect, it } from 'vitest';
import { toArgumentFields, toToolArgumentFields } from './approvalArgumentFields';

describe('toArgumentFields', () => {
  it('keeps object keys in event order as labeled fields', () => {
    expect(
      toArgumentFields({ to: 'grace@example.org', subject: 'Release notes', body: 'Hi\nGrace' })
    ).toEqual({
      fields: [
        { key: 'to', value: { kind: 'text', text: 'grace@example.org' } },
        { key: 'subject', value: { kind: 'text', text: 'Release notes' } },
        { key: 'body', value: { kind: 'text', text: 'Hi\nGrace' } },
      ],
    });
  });

  it('parses a top-level JSON string, as tool-call previews arrive', () => {
    expect(toArgumentFields('{"query": "MindRoom release notes"}')).toEqual({
      fields: [{ key: 'query', value: { kind: 'text', text: 'MindRoom release notes' } }],
    });
  });

  it('unpacks string values that hold a JSON object one level deep', () => {
    expect(
      toArgumentFields({ payload: JSON.stringify({ channel: '#research', silent: true }) })
    ).toEqual({
      fields: [
        {
          key: 'payload',
          value: {
            kind: 'nested',
            fields: [
              { key: 'channel', value: { kind: 'text', text: '#research' } },
              { key: 'silent', value: { kind: 'scalar', text: 'true' } },
            ],
          },
        },
      ],
    });
  });

  it('shows nested objects as fields and anything deeper as formatted JSON', () => {
    expect(toArgumentFields({ options: { retries: 2, headers: { accept: 'json' } } })).toEqual({
      fields: [
        {
          key: 'options',
          value: {
            kind: 'nested',
            fields: [
              { key: 'retries', value: { kind: 'scalar', text: '2' } },
              { key: 'headers', value: { kind: 'json', text: '{\n  "accept": "json"\n}' } },
            ],
          },
        },
      ],
    });
  });

  it('renders numbers, booleans, null, and short primitive lists as scalars', () => {
    expect(toArgumentFields({ count: 3, dry_run: false, cc: null, tags: ['a', 'b'] })).toEqual({
      fields: [
        { key: 'count', value: { kind: 'scalar', text: '3' } },
        { key: 'dry_run', value: { kind: 'scalar', text: 'false' } },
        { key: 'cc', value: { kind: 'scalar', text: 'null' } },
        { key: 'tags', value: { kind: 'scalar', text: 'a, b' } },
      ],
    });
  });

  it('formats empty, long, or complex lists as JSON', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(toArgumentFields({ cc: [], rows })).toEqual({
      fields: [
        { key: 'cc', value: { kind: 'scalar', text: '[]' } },
        { key: 'rows', value: { kind: 'json', text: JSON.stringify(rows, null, 2) } },
      ],
    });
  });

  it('falls back to raw text when a string is not complete JSON', () => {
    expect(toArgumentFields('{"query": "MindRoom rel…')).toEqual({
      raw: '{"query": "MindRoom rel…',
    });
  });

  it('falls back to formatted JSON when the top level is not an object', () => {
    expect(toArgumentFields(['a', 'b'])).toEqual({ raw: '[\n  "a",\n  "b"\n]' });
    expect(toArgumentFields(undefined)).toEqual({ raw: '' });
  });
});

describe('toToolArgumentFields', () => {
  it('splits the key=value preview MindRoom writes for tool calls', () => {
    expect(toToolArgumentFields('query=MindRoom v2026.10.12 release notes, max_results=5')).toEqual({
      fields: [
        { key: 'query', value: { kind: 'text', text: 'MindRoom v2026.10.12 release notes' } },
        { key: 'max_results', value: { kind: 'text', text: '5' } },
      ],
    });
  });

  it('unpacks values MindRoom wrote as compact JSON', () => {
    expect(toToolArgumentFields('payload={"channel": "#research"}, dry_run=true')).toEqual({
      fields: [
        {
          key: 'payload',
          value: {
            kind: 'nested',
            fields: [{ key: 'channel', value: { kind: 'text', text: '#research' } }],
          },
        },
        { key: 'dry_run', value: { kind: 'text', text: 'true' } },
      ],
    });
  });

  it('keeps commas that are not followed by another key inside the value', () => {
    expect(toToolArgumentFields('text=Hi Grace, three changes, to=grace@example.org')).toEqual({
      fields: [
        { key: 'text', value: { kind: 'text', text: 'Hi Grace, three changes' } },
        { key: 'to', value: { kind: 'text', text: 'grace@example.org' } },
      ],
    });
  });

  it('accepts a JSON preview and falls back to raw text without a leading key', () => {
    expect(toToolArgumentFields('{"query": "x"}')).toEqual({
      fields: [{ key: 'query', value: { kind: 'text', text: 'x' } }],
    });
    expect(toToolArgumentFields('reading the notes')).toEqual({ raw: 'reading the notes' });
  });
});
