// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { SnoozePicker } from './SnoozePicker';

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content }: { content: React.ReactNode }) => content,
}));
// jsdom lays nothing out, so focus-trap would find no tabbable node.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const FRIDAY_AFTERNOON = new Date(2026, 10, 13, 15, 30);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      unobserve() {}

      disconnect() {}
    }
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FRIDAY_AFTERNOON);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderPicker = (screenSize: ScreenSize = ScreenSize.Desktop) => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      <ScreenSizeProvider value={screenSize}>
        <SnoozePicker
          anchor={{ x: 0, y: 0, width: 0, height: 0 }}
          onPick={onPick}
          onClose={onClose}
        />
      </ScreenSizeProvider>
    )
  );
  return { onPick, onClose };
};

const option = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], button')].find((node) =>
    node.textContent?.startsWith(label)
  );

const typeDateTime = (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('SnoozePicker', () => {
  it('picks a preset', () => {
    const { onPick, onClose } = renderPicker();

    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(
      'Snooze until'
    );
    const labels = [...document.querySelectorAll('[role="menuitemradio"]')].map(
      (node) => node.textContent
    );
    const expected = [
      'In 1 hour',
      'In 3 hours',
      'Tomorrow 09:00',
      'Next Monday 09:00',
      'Pick date and time',
    ];
    expect(labels).toHaveLength(expected.length);
    expected.forEach((label, index) => expect(labels[index]?.startsWith(label)).toBe(true));
    // Each preset shows the time it picks.
    expect(option('In 1 hour')?.querySelector('[data-choice-detail]')?.textContent).toBe(
      new Intl.DateTimeFormat('en', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(2026, 10, 13, 16, 30))
    );

    act(() => option('Tomorrow 09:00')?.click());

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(new Date(2026, 10, 14, 9, 0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('picks a custom time and refuses a past one', () => {
    const { onPick, onClose } = renderPicker();

    act(() => option('Pick date and time')?.click());
    expect(onClose).not.toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(input).not.toBeNull();
    expect(input?.min).toBe('2026-11-13T15:30');
    const confirm = () => document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(confirm()?.disabled).toBe(true);

    typeDateTime(input!, '2026-11-13T15:00');
    expect(confirm()?.disabled).toBe(true);
    expect(confirm()?.textContent).toBe('Pick a time in the future');
    act(() => confirm()?.form?.requestSubmit());
    expect(onPick).not.toHaveBeenCalled();

    typeDateTime(input!, '2026-11-20T14:45');
    expect(confirm()?.disabled).toBe(false);
    expect(confirm()?.textContent).toBe('Snooze');
    act(() => confirm()?.click());

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(new Date(2026, 10, 20, 14, 45));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from Cancel in the custom time dialog', () => {
    const { onPick, onClose } = renderPicker();
    act(() => option('Pick date and time')?.click());
    act(() => option('Cancel')?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows the presets and the custom time together in a sheet on phones', () => {
    const { onPick, onClose } = renderPicker(ScreenSize.Mobile);

    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet?.getAttribute('aria-label')).toBe('Snooze until');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(sheet?.querySelector('input[type="datetime-local"]')).not.toBeNull();

    act(() => option('In 3 hours')?.click());
    expect(onPick).toHaveBeenCalledWith(new Date(2026, 10, 13, 18, 30));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the sheet from its close button', () => {
    const { onPick, onClose } = renderPicker(ScreenSize.Mobile);
    act(() => document.querySelector<HTMLElement>('button[aria-label="Cancel"]')?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });
});
