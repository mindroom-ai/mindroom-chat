// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { About } from './About';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
  getFlightRecorderStatus: vi.fn(),
  buildFlightRecorderExport: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ children, as = 'div' }: { children?: React.ReactNode; as?: string }) =>
    React.createElement(as, null, children),
  Scroll: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  Button: ({
    children,
    before,
    ...props
  }: {
    children?: React.ReactNode;
    before?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement('button', props, before, children),
  IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Icon: () => null,
  Icons: { Code: 'code', Cross: 'cross', Heart: 'heart' },
  Spinner: () => React.createElement('i'),
  config: { space: { S400: '1rem' } },
  toRem: (value: number) => `${value / 16}rem`,
}));

vi.mock('../../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('main', null, children),
  PageContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  PageHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', null, children),
}));

vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description: string;
    after?: React.ReactNode;
  }) =>
    React.createElement(
      'section',
      { 'data-setting-title': title, 'data-description': description },
      after
    ),
}));

vi.mock('../styles.css', () => ({
  SequenceCardStyle: 'SequenceCardStyle',
}));

vi.mock('../../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ welcome: undefined }),
}));

vi.mock('../../../mindroom/branding/clientBranding', () => ({
  MINDROOM_CLIENT_BRANDING: {
    appName: 'MindRoom',
    logoAlt: 'MindRoom',
    logoSrc: 'logo.svg',
    sourceUrl: 'https://example.test/source',
  },
  getMindroomWelcomePageContent: () => ({ subtitle: 'Chat' }),
}));

vi.mock('../../../mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
}));

vi.mock('../../../mindroom/native/nativeFileSave', () => ({
  saveFile: mocks.saveFile,
}));

vi.mock('../../../mindroom/diagnostics/flightRecorder', () => ({
  getFlightRecorderStatus: mocks.getFlightRecorderStatus,
  buildFlightRecorderExport: mocks.buildFlightRecorderExport,
}));

const diagnosticsTile = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.findByProps({ 'data-setting-title': 'On-device diagnostics' });

const diagnosticsButton = (renderer: ReactTestRenderer): ReactTestInstance =>
  diagnosticsTile(renderer).findByType('button');

describe('About diagnostics export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.getFlightRecorderStatus.mockReturnValue('none');
    mocks.buildFlightRecorderExport.mockReturnValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      fileName: 'mindroom-diagnostics-test.json',
    });
    mocks.saveFile.mockResolvedValue(true);
  });

  it.each([
    ['unexpected', 'Previous session ended unexpectedly.'],
    ['none', 'No unexpected session retained.'],
    ['unavailable', 'Diagnostics storage unavailable.'],
  ])('renders the %s status', (status, description) => {
    mocks.getFlightRecorderStatus.mockReturnValue(status);
    const renderer = create(<About requestClose={vi.fn()} />);

    expect(diagnosticsTile(renderer).props['data-description']).toBe(description);
    renderer.unmount();
  });

  it('does not render diagnostics outside native iOS', () => {
    mocks.isNativeIOS.mockReturnValue(false);
    const renderer = create(<About requestClose={vi.fn()} />);

    expect(
      renderer.root.findAllByProps({ 'data-setting-title': 'On-device diagnostics' })
    ).toHaveLength(0);
    renderer.unmount();
  });

  it('allows only one native save flow at a time', async () => {
    let resolveSave: ((saved: boolean) => void) | undefined;
    const savePending = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    mocks.saveFile.mockReturnValue(savePending);
    const renderer = create(<About requestClose={vi.fn()} />);

    act(() => {
      void diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsButton(renderer).props.disabled).toBe(true);
    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });

    expect(mocks.buildFlightRecorderExport).toHaveBeenCalledOnce();
    expect(mocks.saveFile).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSave?.(true);
      await savePending;
    });
    expect(diagnosticsButton(renderer).props.disabled).toBe(false);
    renderer.unmount();
  });

  it('shows an export error and clears it when a retry starts', async () => {
    mocks.saveFile.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(true);
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsTile(renderer).props['data-description']).toContain('Export failed.');

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });
    expect(diagnosticsTile(renderer).props['data-description']).toBe(
      'No unexpected session retained.'
    );
    renderer.unmount();
  });

  it('treats native picker cancellation as neither success nor failure', async () => {
    mocks.saveFile.mockResolvedValue(false);
    const renderer = create(<About requestClose={vi.fn()} />);

    await act(async () => {
      await diagnosticsButton(renderer).props.onClick();
    });

    expect(diagnosticsButton(renderer).props.disabled).toBe(false);
    expect(diagnosticsTile(renderer).props['data-description']).toBe(
      'No unexpected session retained.'
    );
    expect(diagnosticsButton(renderer).findByType('span').children.join('')).toBe(
      'Export diagnostics'
    );
    renderer.unmount();
  });
});
