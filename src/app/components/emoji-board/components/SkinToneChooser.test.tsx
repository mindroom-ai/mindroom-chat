import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { SkinToneButton, SkinToneOptions } from './SkinToneChooser';

vi.mock('./styles.css', () => ({ EmojiItem: 'EmojiItem' }));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const buttons = () => renderer!.root.findAllByType('button');

it('shows the chosen tone on a raised hand', () => {
  const onPress = vi.fn();
  act(() => {
    renderer = create(<SkinToneButton tone={4} onPress={onPress} />);
  });

  const [button] = buttons();
  expect(button.props.children).toBe('✋🏾');
  expect(button.props['aria-label']).toBe('Skin tone');
  act(() => button.props.onClick());
  expect(onPress).toHaveBeenCalled();
});

it('offers the six tones and marks the current one', () => {
  const onChoose = vi.fn();
  act(() => {
    renderer = create(<SkinToneOptions tone={0} onChoose={onChoose} />);
  });

  const options = buttons();
  expect(options.map((option) => option.props['aria-label'])).toEqual([
    'Default skin tone',
    'Light skin tone',
    'Medium-light skin tone',
    'Medium skin tone',
    'Medium-dark skin tone',
    'Dark skin tone',
  ]);
  expect(options.map((option) => option.props['aria-pressed'])).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  act(() => options[5].props.onClick());
  expect(onChoose).toHaveBeenCalledWith(5);
});
