// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
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
      'M1Revenue$610.0kSourceLedger',
      'M2Revenue$628.3k',
    ]);
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Revenue',
      'Source',
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
});
