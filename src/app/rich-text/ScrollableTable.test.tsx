// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { FootnoteItem, FootnoteLink, FootnoteScopeProvider } from './Footnote';
import { ScrollableTable } from './ScrollableTable';
import type { TableRows } from './tableRows';

vi.mock('./ScrollableTable.css', () =>
  Object.fromEntries(
    [
      'Container',
      'ScrollArea',
      'Table',
      'Hint',
      'Views',
      'Caption',
      'Rows',
      'Row',
      'RowTitle',
      'Pairs',
      'Pair',
      'Label',
      'Value',
    ].map((name) => [name, name])
  )
);

let resize: (() => void) | undefined;
let width = { scroll: 990, client: 300 };

beforeEach(() => {
  width = { scroll: 990, client: 300 };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }

      observe() {}

      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => width.scroll);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width.client);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rows: TableRows<React.ReactNode> = {
  headers: ['Month', 'Revenue', 'Source'],
  rows: [
    [
      'M1',
      '$610.0k',
      <a key="source" href="https://example.com/m1">
        Ledger
      </a>,
    ],
    ['M2', '$628.3k'],
  ],
};

const tableAt = (size = ScreenSize.Mobile, readRows: (() => typeof rows) | null = () => rows) => (
  <ScreenSizeProvider value={size}>
    <ScrollableTable readRows={readRows ?? undefined}>
      <tbody>
        <tr>
          <td>Wide table</td>
        </tr>
      </tbody>
    </ScrollableTable>
  </ScreenSizeProvider>
);

const renderTable = (...args: Parameters<typeof tableAt>) => render(tableAt(...args));

describe('ScrollableTable read by row', () => {
  it('reads a wide simple table on a phone as label: value pairs and switches back', () => {
    renderTable();
    const byRow = screen.getByRole('button', { name: 'Read by row' });
    expect(byRow.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Scroll horizontally')).toBeTruthy();

    fireEvent.click(byRow);
    // One accessibility tree at a time: the table leaves while its rows show.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Scroll horizontally')).toBeNull();
    expect(byRow.getAttribute('aria-pressed')).toBe('true');
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'MonthM1Revenue$610.0kSourceLedger',
      'MonthM2Revenue$628.3k',
    ]);
    // The first column keeps its label too.
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Month',
      'Revenue',
      'Source',
      'Month',
      'Revenue',
    ]);
    expect(screen.getByRole('link', { name: 'Ledger' }).getAttribute('href')).toBe(
      'https://example.com/m1'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it.each([
    ['a resize off phones', ScreenSize.Desktop, () => rows],
    ['a streamed edit that makes the table complex', ScreenSize.Mobile, null],
  ] as const)('moves focus from the leaving reader to the table on %s', (_, size, readRows) => {
    const { rerender } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Read by row' }));
    screen.getByRole('link', { name: 'Ledger' }).focus();
    rerender(tableAt(size, readRows));
    expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('table'));
  });

  it('moves focus from a leaving view chip, but never from outside the table', () => {
    width = { scroll: 990, client: 300 };
    const { rerender } = renderTable();
    screen.getByRole('button', { name: 'Show table' }).focus();
    rerender(tableAt(ScreenSize.Mobile, null));
    expect(document.activeElement).toBe(screen.getByRole('table'));
    cleanup();

    const outside = document.body.appendChild(document.createElement('button'));
    const view = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Read by row' }));
    outside.focus();
    view.rerender(tableAt(ScreenSize.Desktop));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('asks for the rows only while they are read', () => {
    const readRows = vi.fn(() => rows);
    renderTable(ScreenSize.Mobile, readRows);
    expect(readRows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Read by row' }));
    expect(readRows).toHaveBeenCalled();
  });

  it('offers no reader for a table that fits or barely overflows', () => {
    width = { scroll: 300, client: 300 };
    renderTable();
    expect(screen.queryByRole('button', { name: 'Read by row' })).toBeNull();
    width = { scroll: 340, client: 300 };
    act(() => resize?.());
    expect(screen.getByText('Scroll horizontally')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read by row' })).toBeNull();
    width = { scroll: 990, client: 300 };
    act(() => resize?.());
    expect(screen.getByRole('button', { name: 'Read by row' })).toBeTruthy();
  });

  it('offers no reader off phones or for a complex table', () => {
    renderTable(ScreenSize.Desktop);
    expect(screen.getByText('Scroll horizontally')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read by row' })).toBeNull();
    cleanup();
    renderTable(ScreenSize.Mobile, null);
    expect(screen.queryByRole('button', { name: 'Read by row' })).toBeNull();
  });

  it('isolates hidden table footnote IDs in Read by row mode so backrefs focus the visible row anchor', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    const cellRefNode = (
      <sup key="fn1" className="footnote-ref">
        <FootnoteLink href="#fn1" footnoteId="fnref1">
          [1]
        </FootnoteLink>
      </sup>
    );
    const headerRefNode = (
      <sup key="fn2" className="footnote-ref">
        <FootnoteLink href="#fn2" footnoteId="fnref2">
          [2]
        </FootnoteLink>
      </sup>
    );
    const footnoteRows: TableRows<React.ReactNode> = {
      headers: [['Metric', headerRefNode], 'Value'],
      rows: [
        ['Latency', ['12ms', cellRefNode]],
        ['Throughput', '420/s'],
      ],
    };

    const { container } = render(
      <ScreenSizeProvider value={ScreenSize.Mobile}>
        <FootnoteScopeProvider>
          <ScrollableTable readRows={() => footnoteRows}>
            <thead>
              <tr>
                <th>Metric{headerRefNode}</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Latency</td>
                <td>12ms{cellRefNode}</td>
              </tr>
              <tr>
                <td>Throughput</td>
                <td>420/s</td>
              </tr>
            </tbody>
          </ScrollableTable>
          <ol>
            <FootnoteItem footnoteId="fn1">
              <p>
                Measured at p95.{' '}
                <FootnoteLink href="#fnref1" backref>
                  ↩︎
                </FootnoteLink>
              </p>
            </FootnoteItem>
            <FootnoteItem footnoteId="fn2">
              <p>
                Core service metric.{' '}
                <FootnoteLink href="#fnref2" backref>
                  ↩︎
                </FootnoteLink>
              </p>
            </FootnoteItem>
          </ol>
        </FootnoteScopeProvider>
      </ScreenSizeProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Read by row' }));

    const allIds = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    const hiddenCellAnchor = container.querySelector<HTMLAnchorElement>('table td a')!;
    const visibleCellAnchor = container.querySelector<HTMLAnchorElement>('dl dd a')!;
    const cellBackref = container.querySelector<HTMLAnchorElement>('li[id$="-fn1"] a')!;
    const cellItem = container.querySelector<HTMLLIElement>('li[id$="-fn1"]')!;
    expect(hiddenCellAnchor.id).not.toBe(visibleCellAnchor.id);
    expect(cellBackref.getAttribute('href')).toBe(`#${visibleCellAnchor.id}`);

    fireEvent.click(cellBackref);
    expect(scrollIntoView.mock.instances[0]).toBe(visibleCellAnchor);
    expect(document.activeElement).toBe(visibleCellAnchor);
    expect(document.activeElement).not.toBe(hiddenCellAnchor);

    scrollIntoView.mockClear();
    fireEvent.click(visibleCellAnchor);
    expect(scrollIntoView.mock.instances[0]).toBe(cellItem);
    expect(document.activeElement).toBe(cellItem);

    // Repeated header footnotes keep a single DOM ID on row 0 while later rows still link to fn2.
    const headerAnchors = [...container.querySelectorAll<HTMLAnchorElement>('dl dt a')];
    const headerBackref = container.querySelector<HTMLAnchorElement>('li[id$="-fn2"] a')!;
    const headerItem = container.querySelector<HTMLLIElement>('li[id$="-fn2"]')!;
    expect(headerAnchors).toHaveLength(2);
    const [firstHeaderAnchor, secondHeaderAnchor] = headerAnchors;
    if (!firstHeaderAnchor || !secondHeaderAnchor) {
      throw new Error('Expected two rendered header footnote anchors');
    }
    expect(firstHeaderAnchor.id).toMatch(/-fnref2$/);
    expect(secondHeaderAnchor.id).toBe('');
    expect(headerBackref.getAttribute('href')).toBe(`#${firstHeaderAnchor.id}`);

    scrollIntoView.mockClear();
    fireEvent.click(secondHeaderAnchor);
    expect(scrollIntoView.mock.instances[0]).toBe(headerItem);
    expect(document.activeElement).toBe(headerItem);

    scrollIntoView.mockClear();
    fireEvent.click(headerBackref);
    expect(scrollIntoView.mock.instances[0]).toBe(firstHeaderAnchor);
    expect(document.activeElement).toBe(firstHeaderAnchor);

    // Switching back to Show table restores the message scope to the visible table anchors.
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }));
    const visibleTableAnchor = container.querySelector<HTMLAnchorElement>('table td a')!;
    expect(cellBackref.getAttribute('href')).toBe(`#${visibleTableAnchor.id}`);
    fireEvent.click(cellBackref);
    expect(scrollIntoView.mock.instances[0]).toBe(visibleTableAnchor);
    expect(document.activeElement).toBe(visibleTableAnchor);
  });
});
