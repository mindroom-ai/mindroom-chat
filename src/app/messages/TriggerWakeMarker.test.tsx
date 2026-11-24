// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../i18n/locales/additions/ar.json';
import type { TriggerWakeInfo } from '../matrix/protocol/triggerWake';
import { TriggerWakeMarker } from './TriggerWakeMarker';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- required by hoisted inference
const translated = vi.hoisted(() => ({ templates: {} as Record<string, string> }));
const copyMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string, container?: Element | null) => Promise<boolean>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  const t = (key: string, options?: Record<string, unknown>) =>
    translated.templates[key]?.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(options?.[name])
    ) ?? translateFromEn(key, options);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../lib/dom', async () => {
  const actual = await vi.importActual<typeof import('../lib/dom')>('../lib/dom');
  return { ...actual, copyToClipboard: copyMocks.copyToClipboard };
});
vi.mock('./TriggerWakeMarker.css', () => ({
  Marker: 'Marker',
  Trigger: 'Trigger',
  Title: 'Title',
  Summary: 'Summary',
  Panel: 'Panel',
  PanelHeader: 'PanelHeader',
  Meta: 'Meta',
  CopyButton: 'CopyButton',
  Prompt: 'Prompt',
  InlineCode: 'InlineCode',
  Payload: 'Payload',
}));
vi.mock('./Time.css', () => ({}));
vi.mock('@tabler/icons-react', () => ({ IconBolt: () => <svg /> }));
vi.mock('../preferences/useHour24Clock', () => ({ useHour24Clock: () => [true, () => {}] }));
vi.mock('../preferences/useSettingValue', () => ({ useSettingValue: () => 'D MMM YYYY' }));

const TS = Date.UTC(2026, 0, 15, 12, 0);

const reactiveWake = (overrides: Partial<TriggerWakeInfo> = {}): TriggerWakeInfo => ({
  sourceKind: 'reactive',
  triggerId: 'tr_demo_watch',
  kind: 'pr.opened',
  sourceType: 'github',
  triage: 'Urgent fix',
  prompt: 'Review the incoming pull request.',
  eventJson: '{\n  "pr": 42\n}',
  rawBody: 'raw',
  ...overrides,
});

afterEach(() => {
  cleanup();
  translated.templates = {};
  copyMocks.copyToClipboard.mockReset();
});

describe('TriggerWakeMarker', () => {
  it('renders a collapsed reactive wake pill and expands details in place', () => {
    const { container } = render(<TriggerWakeMarker wake={reactiveWake()} ts={TS} />);
    expect(container.querySelector('[data-trigger-wake="reactive"]')).not.toBeNull();

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBeNull();
    expect(trigger.textContent).toBe('Triggeredpr.opened · tr_demo_watch');
    expect(Array.from(trigger.querySelectorAll('bdi')).map((el) => el.textContent)).toEqual([
      'pr.opened',
      'tr_demo_watch',
    ]);
    expect(container.querySelector('[data-trigger-wake-details]')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel?.getAttribute('data-trigger-wake-details')).toBe('true');
    expect(panel?.textContent).toContain('Trigger tr_demo_watch');
    expect(panel?.textContent).toContain('Source github / pr.opened');
    expect(panel?.textContent).toContain('Triage: Urgent fix');
    expect(panel?.querySelector('time')?.getAttribute('datetime')).toBe(new Date(TS).toISOString());
    expect(panel?.textContent).toContain('Review the incoming pull request.');

    const payload = screen.getByRole('region', { name: 'Event payload JSON' });
    expect(payload.tagName).toBe('PRE');
    expect(payload.getAttribute('dir')).toBe('ltr');
    expect(payload.getAttribute('tabindex')).toBe('0');
    expect(payload.textContent).toBe('{\n  "pr": 42\n}');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-trigger-wake-details]')).toBeNull();
  });

  it('renders an external webhook wake without timestamp or JSON payload', () => {
    const wake: TriggerWakeInfo = {
      sourceKind: 'external',
      triggerId: 'deploy-hook',
      kind: 'deploy.finished',
      prompt: 'Staging deploy completed.',
      rawBody: 'Staging deploy completed.',
    };
    const { container } = render(<TriggerWakeMarker wake={wake} />);
    expect(container.querySelector('[data-trigger-wake="external"]')).not.toBeNull();

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('Webhookdeploy.finished · deploy-hook');

    fireEvent.click(trigger);
    const panel = container.querySelector('[data-trigger-wake-details="true"]');
    expect(panel?.textContent).toContain('Trigger deploy-hook');
    expect(panel?.textContent).toContain('Source deploy.finished');
    expect(panel?.textContent).toContain('Staging deploy completed.');
    expect(panel?.querySelector('time')).toBeNull();
    expect(panel?.querySelector('pre')).toBeNull();
  });

  it('falls back to sourceType in summary and deduplicates identical summary parts', () => {
    const { rerender } = render(
      <TriggerWakeMarker
        wake={reactiveWake({ kind: undefined, sourceType: 'monitor', triggerId: 'tr_mon' })}
      />
    );
    expect(screen.getByRole('button').textContent).toBe('Triggeredmonitor · tr_mon');

    rerender(
      <TriggerWakeMarker
        wake={reactiveWake({
          kind: 'deploy-hook',
          sourceType: undefined,
          triggerId: 'deploy-hook',
        })}
      />
    );
    expect(screen.getByRole('button').textContent).toBe('Triggereddeploy-hook');
  });

  it('reveals direction controls in untrusted fields while preserving Arabic bidi isolates', () => {
    translated.templates = {
      'mindroomUi.messages.triggerWakeMarker.triggerLabel':
        ar.mindroomUi.messages.triggerWakeMarker.triggerLabel,
    };
    render(
      <TriggerWakeMarker
        wake={reactiveWake({
          triggerId: 'tr_\u202Edemo',
          prompt: 'Check \u202Epayload',
          eventJson: '{"v": "\u202Ex"}',
        })}
      />
    );
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('tr_<U+202E>demo');

    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel?.textContent).toContain('\u2068tr_<U+202E>demo\u2069');
    expect(panel?.textContent).toContain('Check <U+202E>payload');
    expect(panel?.querySelector('pre')?.textContent).toBe('{"v": "<U+202E>x"}');
  });

  it('renders safe clickable links in the expanded prompt while keeping JSON strictly plain text', () => {
    render(
      <TriggerWakeMarker
        wake={reactiveWake({
          prompt:
            'Inspect [build log](https://example.org/log), https://status.example.org/run/7, [bad](javascript:alert(1)), and <script>alert(1)</script>.',
          eventJson: '{"url": "[build log](https://example.org/log) https://example.org"}',
        })}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    const markdownLink = screen.getByRole('link', { name: 'build log' });
    expect(markdownLink.getAttribute('href')).toBe('https://example.org/log');
    expect(markdownLink.getAttribute('target')).toBe('_blank');
    expect(markdownLink.getAttribute('rel')).toBe('noreferrer noopener');

    const bareLink = screen.getByRole('link', { name: 'https://status.example.org/run/7' });
    expect(bareLink.getAttribute('href')).toBe('https://status.example.org/run/7');
    expect(bareLink.getAttribute('target')).toBe('_blank');
    expect(bareLink.getAttribute('rel')).toBe('noreferrer noopener');

    expect(screen.getAllByRole('link')).toHaveLength(2);
    const panel = screen
      .getByRole('region', { name: 'Event payload JSON' })
      .closest('[data-trigger-wake-details="true"]');
    expect(panel?.querySelector('script')).toBeNull();
    expect(panel?.textContent).toContain('[bad](javascript:alert(1))');
    expect(panel?.textContent).toContain('<script>alert(1)</script>');

    const payload = screen.getByRole('region', { name: 'Event payload JSON' });
    expect(payload.querySelector('a')).toBeNull();
    expect(payload.textContent).toBe(
      '{"url": "[build log](https://example.org/log) https://example.org"}'
    );
  });

  it('copies rawBody from the expanded panel copy button with copied feedback', async () => {
    copyMocks.copyToClipboard.mockResolvedValue(true);
    const rawBody = '@mindroom_helper:example.org Deploy failed\n\n```json\n{"id": 9}\n```';
    render(<TriggerWakeMarker wake={reactiveWake({ rawBody })} />);

    fireEvent.click(screen.getByRole('button'));
    const copyButton = screen.getByRole('button', { name: 'Copy Text' });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyMocks.copyToClipboard).toHaveBeenCalledWith(rawBody, copyButton);
      expect(screen.getByRole('button', { name: 'Copied' })).toBe(copyButton);
    });
  });
});
