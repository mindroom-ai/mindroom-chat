import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import enAdditions from '../i18n/locales/additions/en.json';
import { describeRoomStateChange, RoomStateSentence } from './roomStateChange';

const KEYS = 'mindroomUi.threads.roomTimelineStateEventRenderers';

const stateEvent = (type: string, content: Record<string, unknown>) =>
  new MatrixEvent({ type, state_key: '', sender: '@robin:example.org', content });

describe('describeRoomStateChange', () => {
  it('quotes a new room name and topic, trimmed', () => {
    expect(describeRoomStateChange(stateEvent('m.room.name', { name: ' Design studio ' }))).toEqual(
      {
        key: `${KEYS}.changedRoomNameTo`,
        value: 'Design studio',
      }
    );
    expect(
      describeRoomStateChange(stateEvent('m.room.topic', { topic: 'Weekly planning and notes' }))
    ).toEqual({ key: `${KEYS}.changedRoomTopicTo`, value: 'Weekly planning and notes' });
  });

  it('reads a missing, blank or malformed name or topic as removed', () => {
    expect(describeRoomStateChange(stateEvent('m.room.name', {}))).toEqual({
      key: `${KEYS}.removedRoomName`,
    });
    expect(describeRoomStateChange(stateEvent('m.room.name', { name: 42 }))).toEqual({
      key: `${KEYS}.removedRoomName`,
    });
    expect(describeRoomStateChange(stateEvent('m.room.topic', { topic: '  \n ' }))).toEqual({
      key: `${KEYS}.removedRoomTopic`,
    });
  });

  it('says only that a redacted name or topic changed', () => {
    const redacted = stateEvent('m.room.topic', {});
    redacted.setUnsigned({ redacted_because: { type: 'm.room.redaction' } as never });
    expect(redacted.isRedacted()).toBe(true);
    expect(describeRoomStateChange(redacted)).toEqual({ key: `${KEYS}.changedRoomTopic` });
  });

  it('keeps the avatar sentence and ignores other events', () => {
    expect(describeRoomStateChange(stateEvent('m.room.avatar', { url: 'mxc://a/b' }))).toEqual({
      key: `${KEYS}.changedRoomAvatar`,
    });
    expect(describeRoomStateChange(stateEvent('m.room.power_levels', {}))).toBeUndefined();
  });
});

describe('RoomStateSentence', () => {
  const render = async (event: MatrixEvent, sender: string) => {
    const language = createInstance();
    // The app's own interpolation setting; the sentence escapes its values itself.
    await language.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: { en: { translation: enAdditions } },
    });
    const change = describeRoomStateChange(event);
    if (!change) throw new Error('no change');
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <RoomStateSentence change={change} sender={sender} />
        </I18nextProvider>
      );
    });
    if (!renderer) throw new Error('not rendered');
    return renderer;
  };
  type Node = string | { children: Node[] | null } | Node[] | null;
  const textOf = (node: Node): string => {
    if (node === null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(textOf).join('');
    return textOf(node.children);
  };
  const text = (renderer: ReturnType<typeof create>): string => textOf(renderer.toJSON() as Node);

  it('quotes the new name in an isolated span and keeps markup in it as text', async () => {
    const renderer = await render(
      stateEvent('m.room.name', { name: 'Notes <3 & <i>more</i>' }),
      'Robin'
    );
    expect(renderer.root.findByType('b').children).toEqual(['Robin']);
    expect(renderer.root.findByType('b').props.dir).toBe('auto');
    expect(renderer.root.findByType('bdi').children).toEqual(['Notes <3 & <i>more</i>']);
    expect(text(renderer)).toBe('Robin changed the room name to “Notes <3 & <i>more</i>”');
  });

  it('says the topic changed to its new text, or was removed', async () => {
    const topic = await render(
      stateEvent('m.room.topic', { topic: 'Weekly planning and notes' }),
      'Robin'
    );
    expect(text(topic)).toBe('Robin changed the topic to “Weekly planning and notes”');
    expect(text(await render(stateEvent('m.room.topic', { topic: '' }), 'Robin'))).toBe(
      'Robin removed the topic'
    );
    expect(text(await render(stateEvent('m.room.name', {}), 'Robin'))).toBe(
      'Robin removed the room name'
    );
  });
});
