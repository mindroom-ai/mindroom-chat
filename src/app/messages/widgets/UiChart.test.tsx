// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartWidget } from './chartSchema';
import { UiChart } from './UiChart';

const SPEC_CHART: ChartWidget = {
  type: 'chart',
  kind: 'line',
  title: 'Signups',
  labels: ['Jan', 'Feb', 'Mar'],
  series: [{ name: 'Signups', data: [120, 180.5, 150] }],
  y: 'users',
};

let cardWidth = 600;

beforeEach(() => {
  cardWidth = 600;
  // jsdom lays nothing out: the card reports the width each test sets.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly onResize: ResizeObserverCallback) {}

      observe(target: Element) {
        this.onResize(
          [{ target, contentRect: { width: cardWidth } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }

      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const live = (container: HTMLElement) => container.querySelector('[aria-live="polite"]');

describe('UiChart', () => {
  it('shows the title, the y title and a Chart/Table toggle', () => {
    render(<UiChart chart={SPEC_CHART} />);

    expect(screen.getByText('Signups', { selector: 'figcaption *' })).toBeTruthy();
    expect(screen.getByText('users')).toBeTruthy();
    const chart = screen.getByRole('button', { name: 'Chart' });
    const table = screen.getByRole('button', { name: 'Table' });
    expect(chart.getAttribute('aria-pressed')).toBe('true');
    expect(table.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to a table with the labels as row headers, and back', () => {
    const { container } = render(<UiChart chart={SPEC_CHART} />);

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect([...table!.querySelectorAll('th[scope="row"]')].map((th) => th.textContent)).toEqual([
      'Jan',
      'Feb',
      'Mar',
    ]);
    expect(within(table!).getByText('180.5')).toBeTruthy();
    expect(container.querySelector('[tabindex="0"] svg')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(container.querySelector('[tabindex="0"] svg')).toBeTruthy();
  });

  it('moves between points with the keyboard and announces them politely', () => {
    const { container } = render(<UiChart chart={SPEC_CHART} />);
    const plot = container.querySelector('[tabindex="0"]') as HTMLElement;

    fireEvent.focus(plot);
    expect(live(container)?.textContent).toContain('Jan');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(live(container)?.textContent).toBe('Feb: Signups 180.5');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(live(container)?.textContent).toContain('Mar');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(live(container)?.textContent).toContain('Jan');
  });

  it('shows a pie as a donut with a legend row per label and its share', () => {
    const pie: ChartWidget = {
      type: 'chart',
      kind: 'pie',
      title: 'Topics',
      labels: ['Alpha', 'Beta', 'Gamma'],
      series: [{ name: 'Tickets', data: [1, 0, 3] }],
    };
    const { container } = render(<UiChart chart={pie} />);

    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['Alpha1 (25%)', 'Beta0 (0%)', 'Gamma3 (75%)']);
  });

  it('draws 200 points at 390 pixels with labels that keep apart', () => {
    cardWidth = 390;
    const labels = Array.from({ length: 200 }, (_, index) => `D${index + 1}`);
    const chart: ChartWidget = {
      type: 'chart',
      kind: 'line',
      title: 'Daily',
      labels,
      series: [{ name: 'Load', data: labels.map((_, index) => index % 7) }],
    };
    const { container } = render(<UiChart chart={chart} />);

    const svg = container.querySelector('[tabindex="0"] svg');
    expect(svg?.getAttribute('width')).toBe('390');
    const shown = [...svg!.querySelectorAll('text')].filter((t) => /^D\d+$/.test(t.textContent!));
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThanOrEqual(10);
    expect(screen.queryByText('Chart')).toBeNull();
  });

  it('keeps small and large values exact enough in the table', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      series: [{ name: 'Tiny', data: [0.00049, 5e-324, 1234.5] }],
    };
    const { container } = render(<UiChart chart={chart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    const cells = [...container.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['0.00049', '5E-324', '1,234.5']);
  });

  it('tells adjacent large values apart in the table', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      series: [{ name: 'Big', data: [1234567000000000, 1234567000000001, 0.1] }],
    };
    const { container } = render(<UiChart chart={chart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    const cells = [...container.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['1.234567E15', '1.234567000000001E15', '0.1']);
  });

  it('keeps the highlighted band inside the plot at both ends', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      labels: ['A', 'B'],
      series: [{ name: 'S', data: [1, 2] }],
    };
    const { container } = render(<UiChart chart={chart} />);
    const plot = container.querySelector('[tabindex="0"]') as HTMLElement;
    const svg = plot.querySelector('svg')!;
    const width = Number(svg.getAttribute('width'));

    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'End' });
    const rects = [...svg.querySelectorAll('rect')];
    rects.forEach((rect) => {
      const x = Number(rect.getAttribute('x'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + Number(rect.getAttribute('width'))).toBeLessThanOrEqual(width);
    });
  });

  it('keeps 200 groups of eight bars apart at 390 pixels', () => {
    cardWidth = 390;
    const labels = Array.from({ length: 200 }, (_, index) => `D${index + 1}`);
    const series = Array.from({ length: 8 }, (_, number) => ({
      name: `S${number}`,
      data: labels.map((_, index) => index + number + 1),
    }));
    const { container } = render(
      <UiChart chart={{ type: 'chart', kind: 'bar', title: 'Dense', labels, series }} />
    );

    const bars = [...container.querySelectorAll('[tabindex="0"] svg rect[fill]')]
      .filter((rect) => rect.getAttribute('fill') !== 'transparent')
      .map((rect) => [Number(rect.getAttribute('x')), Number(rect.getAttribute('width'))])
      .sort(([a], [b]) => a! - b!);
    expect(bars).toHaveLength(1600);
    bars.slice(1).forEach(([x], index) => {
      const [previousX, previousWidth] = bars[index]!;
      expect(previousX! + previousWidth!).toBeLessThanOrEqual(x! + 1e-9);
    });
  });

  it('shows only the table when the values cannot be scaled', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      series: [{ name: 'Wide', data: [1e308, -1e308, 0] }],
    };
    const { container } = render(<UiChart chart={chart} />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chart' })).toBeNull();
  });

  it('lays the card out in the interface direction, its plot left to right', () => {
    vi.spyOn(i18next, 'dir').mockReturnValue('rtl');
    const { container } = render(<UiChart chart={SPEC_CHART} />);

    const figure = container.querySelector('figure')!;
    expect(figure.getAttribute('dir')).toBe('rtl');
    expect(figure.firstElementChild?.tagName).toBe('FIGCAPTION');
    expect(figure.querySelector('figcaption [dir="auto"]')?.textContent).toBe('Signups');
    expect(container.querySelector('[tabindex="0"]')?.getAttribute('dir')).toBe('ltr');
  });

  it('shows direction controls in authored text as code points', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      title: 'Sign\u202Eups',
      labels: ['J\u2066an', 'Feb', 'Mar'],
    };
    const { container } = render(<UiChart chart={chart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(container.querySelector('figcaption')?.textContent).toContain('Sign<U+202E>ups');
    expect(container.querySelector('th[scope="row"]')?.textContent).toBe('J<U+2066>an');
  });

  it('renders every widget string as text', () => {
    const chart: ChartWidget = {
      ...SPEC_CHART,
      title: '<img src=x onerror=1>',
      labels: ['https://example.com', 'Feb', 'Mar'],
    };
    const { container } = render(<UiChart chart={chart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(screen.getAllByText('<img src=x onerror=1>').length).toBeGreaterThan(0);
    expect(screen.getAllByText('https://example.com').length).toBeGreaterThan(0);
    expect(container.querySelector('img, a, image')).toBeNull();
  });
});
