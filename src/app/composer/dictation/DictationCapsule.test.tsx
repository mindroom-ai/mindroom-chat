// @vitest-environment jsdom
import React from 'react';
import { createStore, Provider } from 'jotai';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationViewContext, HOME_ASK_VIEW } from '../../navigation/conversationView';
import { liveCaptureCapsulesShownAtom } from '../capture/liveCapture';
import * as voiceCss from '../voice/VoiceRecordingCapsule.css';
import { DictationCapsule } from './DictationCapsule';
import type { DictationSnapshot } from './dictationSession';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${key}:${String(params.count)}`;
      if (params?.time !== undefined) return `${key}:${String(params.time)}`;
      return key;
    },
  }),
}));

vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({
  useLiquidGlass: () => ({ current: null }),
}));

vi.mock('../../messages/content/voice/VoiceWaveform', () => ({
  VoiceWaveform: ({ liveSampleCount, dimmed }: { liveSampleCount?: number; dimmed?: boolean }) => (
    <div data-testid="waveform" data-live={liveSampleCount ?? ''} data-dimmed={String(!!dimmed)} />
  ),
}));

vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

const baseSnapshot = (overrides: Partial<DictationSnapshot> = {}): DictationSnapshot => ({
  phase: 'recording',
  elapsedMs: 18_000,
  waveform: [100, 400, 800],
  sampleCount: 3,
  pendingUploads: 0,
  failedSegments: 0,
  completedSegments: 0,
  hasPartialText: false,
  previewText: '',
  capReached: false,
  interrupted: false,
  recovered: false,
  hasClient: true,
  errorMessage: undefined,
  ...overrides,
});

const handlers = () => ({
  onCancel: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onFinish: vi.fn(),
  onRetry: vi.fn(),
  onInsertPartial: vi.fn(),
  onDiscard: vi.fn(),
  onDismissError: vi.fn(),
});

afterEach(() => cleanup());

describe('DictationCapsule', () => {
  it('renders Cancel, live waveform, timer, Pause, and Finish while recording', () => {
    const h = handlers();
    const { container } = render(<DictationCapsule snapshot={baseSnapshot()} {...h} />);
    expect(container.firstElementChild?.className).toBe(voiceCss.Container);

    expect(screen.getByText('0:18')).toBeTruthy();
    expect(screen.queryByTestId('dictation-preview')).toBeNull();
    expect(screen.getByTestId('waveform').getAttribute('data-live')).toBe('3');
    expect(screen.getByTestId('waveform').getAttribute('data-dimmed')).toBe('false');

    fireEvent.click(screen.getByLabelText('composer.dictation.cancel'));
    fireEvent.click(screen.getByLabelText('composer.dictation.pause'));
    fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onPause).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledTimes(1);
  });

  it('shows Resume when paused and subtle status when segments are pending retry or finishing', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule snapshot={baseSnapshot({ phase: 'paused', failedSegments: 1 })} {...h} />
    );

    expect(screen.getByTestId('waveform').getAttribute('data-dimmed')).toBe('true');
    expect(screen.getAllByText('composer.dictation.statusPendingRetry:1').length).toBeGreaterThan(
      0
    );
    fireEvent.click(screen.getByLabelText('composer.dictation.resume'));
    expect(h.onResume).toHaveBeenCalledTimes(1);

    rerender(<DictationCapsule snapshot={baseSnapshot({ phase: 'finishing' })} {...h} />);
    expect(screen.getAllByText('composer.dictation.statusFinishing').length).toBeGreaterThan(0);
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.finish').disabled).toBe(
      true
    );
  });

  it('renders inline recovery actions on failure and shows Insert partial only when partial text exists', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'failed',
          failedSegments: 1,
          completedSegments: 1,
          hasPartialText: true,
          errorMessage: 'Upstream timeout',
        })}
        {...h}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('Upstream timeout');
    fireEvent.click(screen.getByText('composer.dictation.retry'));
    fireEvent.click(screen.getByText('composer.dictation.insertPartial'));
    fireEvent.click(screen.getByText('composer.dictation.discard'));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect(h.onInsertPartial).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);

    rerender(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'failed',
          failedSegments: 1,
          completedSegments: 0,
          hasPartialText: false,
          errorMessage: 'Failed',
        })}
        {...h}
      />
    );
    expect(screen.queryByText('composer.dictation.insertPartial')).toBeNull();
  });

  it('renders a dismissible alert banner when idle with a microphone error', () => {
    const h = handlers();
    render(
      <DictationCapsule
        snapshot={baseSnapshot({ phase: 'idle', errorMessage: 'Microphone permission denied.' })}
        {...h}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('Microphone permission denied.');
    expect(screen.queryByTestId('dictation-preview')).toBeNull();
    fireEvent.click(screen.getByLabelText('composer.dictation.dismissError'));
    expect(h.onDismissError).toHaveBeenCalledTimes(1);
  });

  it('renders live preview during recording, paused, finishing, and failed only when previewText is non-empty', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule
        snapshot={baseSnapshot({ phase: 'recording', previewText: 'Hello world.' })}
        {...h}
      />
    );

    for (const phase of ['recording', 'paused', 'finishing', 'failed'] as const) {
      rerender(
        <DictationCapsule
          snapshot={baseSnapshot({
            phase,
            previewText: 'Hello world.',
            hasPartialText: true,
            failedSegments: phase === 'failed' ? 1 : 0,
          })}
          {...h}
        />
      );
      const preview = screen.getByTestId('dictation-preview');
      expect(preview.textContent).toBe('Hello world.');
      expect(preview.getAttribute('aria-label')).toBe('composer.dictation.previewLabel');
      expect(preview.getAttribute('role')).toBe('region');
      if (phase === 'failed') {
        expect(screen.getByRole('alert').contains(preview)).toBe(false);
      }
    }

    rerender(
      <DictationCapsule snapshot={baseSnapshot({ phase: 'paused', previewText: '' })} {...h} />
    );
    expect(screen.queryByTestId('dictation-preview')).toBeNull();
  });

  it('auto-scrolls the preview container to the bottom when previewText updates', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule
        snapshot={baseSnapshot({ phase: 'recording', previewText: 'First phrase.' })}
        {...h}
      />
    );

    const preview = screen.getByTestId('dictation-preview');
    let mockScrollHeight = 140;
    Object.defineProperty(preview, 'scrollHeight', {
      configurable: true,
      get: () => mockScrollHeight,
    });
    preview.scrollTop = 0;

    rerender(
      <DictationCapsule
        snapshot={baseSnapshot({ phase: 'recording', previewText: 'First phrase. Second phrase.' })}
        {...h}
      />
    );
    expect(preview.scrollTop).toBe(140);

    mockScrollHeight = 260;
    rerender(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'recording',
          previewText: 'First phrase. Second phrase. Third phrase.',
        })}
        {...h}
      />
    );
    expect(preview.scrollTop).toBe(260);
  });

  it('renders disabled controls with statusSending and Retry & send recovery when sending is true', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule
        snapshot={baseSnapshot({ phase: 'finishing', previewText: 'Draft in flight.' })}
        sending
        {...h}
      />
    );

    expect(screen.getAllByText('composer.dictation.statusSending').length).toBeGreaterThan(0);
    expect(screen.getByTestId('dictation-preview').textContent).toBe('Draft in flight.');
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.cancel').disabled).toBe(
      true
    );
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.pause').disabled).toBe(
      true
    );
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.finish').disabled).toBe(
      true
    );

    rerender(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'failed',
          failedSegments: 1,
          hasPartialText: true,
          previewText: 'Partial text.',
          errorMessage: 'Network error',
        })}
        sending
        {...h}
      />
    );

    fireEvent.click(screen.getByText('composer.dictation.retryAndSend'));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('composer.dictation.retry')).toBeNull();
  });

  it('tracks liveCaptureCapsulesShownAtom only when showingLive is true (including HOME_ASK_VIEW)', () => {
    const h = handlers();
    const store = createStore();

    const detached = render(
      <Provider store={store}>
        <DictationCapsule
          snapshot={baseSnapshot({ phase: 'finishing' })}
          sending
          showingLive={false}
          {...h}
        />
      </Provider>
    );
    expect(store.get(liveCaptureCapsulesShownAtom)).toBe(0);
    detached.unmount();

    const homeLive = render(
      <Provider store={store}>
        <ConversationViewContext.Provider value={HOME_ASK_VIEW}>
          <DictationCapsule snapshot={baseSnapshot({ phase: 'recording' })} showingLive {...h} />
        </ConversationViewContext.Provider>
      </Provider>
    );
    expect(store.get(liveCaptureCapsulesShownAtom)).toBe(1);
    homeLive.unmount();
    expect(store.get(liveCaptureCapsulesShownAtom)).toBe(0);
  });

  it('shows recovered duration timer, disables Resume without a client, and notes untranscribed segments', () => {
    const h = handlers();
    const { rerender } = render(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'paused',
          elapsedMs: 65_000,
          recovered: true,
          hasClient: false,
          pendingUploads: 2,
          failedSegments: 1,
          previewText: 'Already transcribed.',
        })}
        showingLive
        {...h}
      />
    );

    expect(screen.getByText('composer.dictation.recoveredDuration:1:05')).toBeTruthy();
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.resume').disabled).toBe(
      true
    );
    expect(screen.getAllByText('composer.dictation.statusPendingRetry:3').length).toBeGreaterThan(
      0
    );
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.finish').disabled).toBe(
      false
    );

    rerender(
      <DictationCapsule
        snapshot={baseSnapshot({
          phase: 'paused',
          elapsedMs: 65_000,
          recovered: true,
          hasClient: true,
          pendingUploads: 0,
          failedSegments: 0,
          previewText: 'Already transcribed.',
        })}
        showingLive
        {...h}
      />
    );
    expect(screen.getByLabelText<HTMLButtonElement>('composer.dictation.resume').disabled).toBe(
      false
    );
    expect(screen.getByRole('status').textContent).toBe('composer.dictation.statusRecovered');
  });
});
