import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceMessageVolumeAtom } from '../../mindroom/settings/voiceMessageSettings';
import { VoiceVolumeButton } from './VoiceVolumeButton';

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('i', props),
  Icons: { VolumeHigh: 'volume-high', VolumeMute: 'volume-mute' },
}));

vi.mock('../directional', () => ({
  PopOut: ({
    anchor,
    content,
    position,
    align,
  }: {
    anchor?: unknown;
    content: React.ReactNode;
    position?: string;
    align?: string;
  }) =>
    anchor
      ? React.createElement('div', { 'data-popout': position, 'data-align': align }, content)
      : null,
}));

vi.mock('../glass/GlassPrimitives', () => ({
  Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('react-range', () => ({
  Range: ({
    renderTrack,
    renderThumb,
  }: {
    renderTrack: (params: {
      props: Record<string, unknown>;
      children: React.ReactNode;
    }) => React.ReactNode;
    renderThumb: (params: { props: Record<string, unknown> }) => React.ReactNode;
  }) => renderTrack({ props: {}, children: renderThumb({ props: { key: 'thumb' } }) }),
}));

vi.mock('./VoiceVolumeButton.css', () => ({
  Menu: 'Menu',
  Thumb: 'Thumb',
  Track: 'Track',
  TrackLine: 'TrackLine',
}));

const render = (store = createStore()): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <VoiceVolumeButton className="Row" />
      </Provider>
    );
  });
  if (!renderer) throw new Error('VoiceVolumeButton failed to render');
  return renderer;
};

const row = (renderer: ReactTestRenderer) => renderer.root.findByType('button');

describe('VoiceVolumeButton', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a labeled menu row that opens the slider chip below its end', () => {
    const renderer = render();
    const button = row(renderer);

    expect(button.type).toBe('button');
    expect(button.props.type).toBe('button');
    expect(button.props['aria-label']).toBe('Voice volume, currently 100%');
    expect(button.findByType('span').props.children).toBe('Voice volume');
    expect(button.findByProps({ src: 'volume-high' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ 'data-popout': 'Bottom' })).toHaveLength(0);

    act(() => {
      button.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 240 }) },
      });
    });

    const chip = renderer.root.findByProps({ 'data-popout': 'Bottom' });
    expect(chip.props['data-align']).toBe('End');
    expect(row(renderer).props['aria-expanded']).toBe(true);
    expect(chip.findByProps({ 'aria-label': 'Voice volume' }).props.className).toBe('Thumb');
    // The track is one quiet line: no fill paints the part before the thumb.
    expect(chip.findByProps({ className: 'TrackLine' }).props.style).toBeUndefined();
  });

  it('shows the mute icon and 0 % at volume 0', () => {
    const store = createStore();
    store.set(voiceMessageVolumeAtom, 0);
    const button = row(render(store));

    expect(button.props['aria-label']).toBe('Voice volume, currently 0%');
    expect(button.findByProps({ src: 'volume-mute' })).toBeTruthy();
  });
});
