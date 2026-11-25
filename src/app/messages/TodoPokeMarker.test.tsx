// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoPokeInfo } from '../matrix/protocol/todoPoke';
import { TodoPokeMarker } from './TodoPokeMarker';

const copyMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string, container?: Element | null) => Promise<boolean>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => translateFromEn(key, options),
      i18n: { language: 'en' },
    }),
  };
});
vi.mock('../lib/dom', async () => {
  const actual = await vi.importActual<typeof import('../lib/dom')>('../lib/dom');
  return { ...actual, copyToClipboard: copyMocks.copyToClipboard };
});
vi.mock('./TodoPokeMarker.css', () => ({
  Marker: 'Marker',
  Eyebrow: 'Eyebrow',
  EyebrowMain: 'EyebrowMain',
  Title: 'Title',
  Meta: 'Meta',
  Toggle: 'Toggle',
  Body: 'Body',
  List: 'List',
  Item: 'Item',
  PriorityDot: { critical: 'dot-c', high: 'dot-h', medium: 'dot-m', low: 'dot-l' },
  ItemTitle: 'ItemTitle',
  ItemMeta: 'ItemMeta',
  PriorityPill: { critical: 'pill-c', high: 'pill-h', medium: 'pill-m', low: 'pill-l' },
  IdButton: 'IdButton',
  Overflow: 'Overflow',
}));
vi.mock('./Time.css', () => ({}));
vi.mock('@tabler/icons-react', () => ({ IconChecklist: () => <svg /> }));
vi.mock('../preferences/useHour24Clock', () => ({ useHour24Clock: () => [true, () => {}] }));
vi.mock('../preferences/useSettingValue', () => ({ useSettingValue: () => 'D MMM YYYY' }));

const TS = Date.UTC(2026, 0, 15, 13, 33);

const busyPoke = (overrides: Partial<TodoPokeInfo> = {}): TodoPokeInfo => ({
  assignedAgent: 'maya',
  totalCount: 6,
  rawBody: 'raw',
  items: [
    { id: 'f10c3a89', priority: 'critical', title: 'Fix session token refresh race' },
    { id: 'd94e21b4', priority: 'high', title: 'Verify migration rollback script' },
    { id: 'a4f19c20', priority: 'medium', title: 'Publish API changelog for v2.4 release' },
    { id: '73c8a102', priority: 'low', title: 'Trim unused CSS utility classes' },
  ],
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  copyMocks.copyToClipboard.mockReset();
});

describe('TodoPokeMarker', () => {
  it('renders expanded by default with count, agent, timestamp, all 4 priorities, and overflow', () => {
    const { container } = render(
      <TodoPokeMarker poke={busyPoke()} ts={TS} senderDisplayName="Maya" />
    );

    expect(container.querySelector('[data-todo-poke="true"]')).not.toBeNull();
    expect(container.textContent).toContain('6 todos ready');
    expect(container.textContent).toContain('Maya');
    expect(container.querySelector('.Meta time')?.getAttribute('datetime')).toBe(
      new Date(TS).toISOString()
    );

    const toggle = screen.getByRole('button', { name: 'Hide' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(list?.tagName).toBe('UL');
    expect(list?.querySelectorAll('li')).toHaveLength(4);
    for (const text of [
      'Critical',
      'High',
      'Medium',
      'Low',
      'Publish API changelog for v2.4 release',
    ]) {
      expect(list?.textContent).toContain(text);
    }
    expect(container.textContent).toContain('+2 more actionable items');
  });

  it('toggles Hide/Show, formats singular count, falls back from MXID, and reveals bidi controls', () => {
    const { container } = render(
      <TodoPokeMarker
        poke={busyPoke({
          assignedAgent: 'maya_\u202Eagent',
          totalCount: 1,
          items: [{ id: 'a4\u202Ef1', priority: 'high', title: 'Check \u202Eoverride' }],
        })}
        senderDisplayName="@mindroom_maya:example.org"
      />
    );

    expect(screen.getByText('1 todo ready')).not.toBeNull();
    expect(container.textContent).toContain('maya_<U+202E>agent');
    expect(container.textContent).toContain('Check <U+202E>override');
    expect(container.textContent).toContain('a4<U+202E>f1');

    const toggle = screen.getByRole('button', { name: 'Hide' });
    const listId = toggle.getAttribute('aria-controls') ?? '';
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('Show');
    expect(document.getElementById(listId)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(listId)).not.toBeNull();
  });

  it('copies the todo ID, shows Copied for 2000ms, and clears its timer on unmount', async () => {
    vi.useFakeTimers();
    copyMocks.copyToClipboard.mockResolvedValue(true);

    const { unmount } = render(<TodoPokeMarker poke={busyPoke()} />);
    const idButton = screen.getByRole('button', { name: 'Copy todo ID a4f19c20' });

    await act(async () => {
      fireEvent.click(idButton);
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenCalledWith('a4f19c20', idButton);
    expect(idButton.textContent).toBe('Copied');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(idButton.textContent).toBe('a4f19c20');

    await act(async () => {
      fireEvent.click(idButton);
      await Promise.resolve();
    });
    unmount();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
