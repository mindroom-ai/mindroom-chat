import React, { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box, Spinner, Text } from 'folds';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { MindRoomSplashScreen, pickMindRoomSplashMessage } from './BrandedSplashScreen';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Spinner: () => <div />,
  Text: ({ children }: { children?: ReactNode }) => <span data-line>{children}</span>,
}));
vi.mock('./SplashScreen', () => ({
  SplashScreen: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

type SplashProps = React.ComponentProps<typeof MindRoomSplashScreen>;

/** The splash with `props`, under a loaded `config` when one is given. */
const renderSplash = (props: SplashProps, config?: ClientConfig) => {
  let renderer: ReactTestRenderer | undefined;
  const splash = <MindRoomSplashScreen {...props} />;
  act(() => {
    renderer = create(
      config ? <ClientConfigProvider value={config}>{splash}</ClientConfigProvider> : splash
    );
  });
  if (!renderer) throw new Error('not rendered');
  return renderer;
};

const shownLine = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ 'data-line': true }).children.join('');

/** This browser's copy of the last configuration it loaded (ClientConfigLoader's cache). */
const cacheConfig = (config: unknown) =>
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key.endsWith('/config.json') ? JSON.stringify(config) : null),
  });

describe('MindRoomSplashScreen line', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a given message instead of a picked line, even an empty one', () => {
    const random = vi.fn(() => 0);

    expect(
      shownLine(renderSplash({ message: 'Connecting to server', loadingMessages: ['One'], random }))
    ).toBe('Connecting to server');
    expect(shownLine(renderSplash({ message: '', loadingMessages: ['One'], random }))).toBe('');
    expect(random).not.toHaveBeenCalled();
  });

  it('uses the translated line when every configured line is blank', () => {
    expect(shownLine(renderSplash({ loadingMessages: ['', '   '], random: () => 0.5 }, {}))).toBe(
      'Loading MindRoom'
    );
  });

  it("names the deployment's brand in the translated line", () => {
    expect(shownLine(renderSplash({}, { branding: { title: 'Example Co' } }))).toBe(
      'Loading Example Co'
    );
    expect(
      shownLine(
        renderSplash({}, { branding: { title: 'Example Co' }, splash: { loadingMessages: ['Hi'] } })
      )
    ).toBe('Hi');
  });

  it('shows only the spinner before any configuration is known, as a line may name another app', () => {
    cacheConfig(null);
    const renderer = renderSplash({});
    expect(renderer.root.findAllByProps({ 'data-line': true })).toHaveLength(0);
    expect(renderer.root.findAllByType(Spinner)).toHaveLength(1);
  });

  it('takes the line of the last configuration this browser loaded until one loads', () => {
    cacheConfig({ branding: { title: 'Example Co' } });
    expect(shownLine(renderSplash({}))).toBe('Loading Example Co');
    cacheConfig({ splash: { loadingMessages: ['Waking up your agents'] } });
    expect(shownLine(renderSplash({}))).toBe('Waking up your agents');
  });

  it('picks the first line at 0 and the last line at exactly 1', () => {
    const lines = [' One ', 'Two', 'Three '];

    expect(pickMindRoomSplashMessage(lines, () => 0)).toBe('One');
    expect(pickMindRoomSplashMessage(lines, () => 1)).toBe('Three');
    expect(pickMindRoomSplashMessage(lines, () => -0.5)).toBe('One');
    expect(pickMindRoomSplashMessage(undefined, () => 0.5)).toBe('Loading MindRoom');
  });

  it('keeps its line across renders until it gets a new list', () => {
    const answers = [0, 0.99];
    const random = vi.fn(() => answers.shift() ?? 0);
    const lines = ['Waking up your agents', 'Syncing your rooms'];
    const renderer = renderSplash({ loadingMessages: lines, random });

    act(() => {
      renderer.update(<MindRoomSplashScreen loadingMessages={lines} random={random} />);
    });
    expect(shownLine(renderer)).toBe('Waking up your agents');
    expect(random).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(<MindRoomSplashScreen loadingMessages={[...lines]} random={random} />);
    });
    expect(shownLine(renderer)).toBe('Syncing your rooms');
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('shows the spinner, the line and then the children in one centred column', () => {
    const renderer = renderSplash({
      message: 'Connecting to server',
      children: <button type="button">Cancel</button>,
    });
    const column = renderer.root.findByType(Box);

    expect(column.props).toMatchObject({
      direction: 'Column',
      grow: 'Yes',
      alignItems: 'Center',
      justifyContent: 'Center',
      gap: '400',
    });
    expect(renderer.root.findByType(Spinner).props).toMatchObject({
      variant: 'Secondary',
      size: '600',
    });
    const parts = column.findByType('div').children;
    expect(parts.map((part) => (typeof part === 'string' ? part : part.type))).toEqual([
      Spinner,
      Text,
      'button',
    ]);
  });
});
