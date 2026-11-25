import { ComponentPropsWithoutRef, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, Text } from 'folds';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { FootnoteScopeProvider, FootnoteSuppressIds } from './Footnote';
import type { TableRows } from './tableRows';
import * as css from './ScrollableTable.css';

type ScrollableTableProps = ComponentPropsWithoutRef<'table'> & {
  /** The cells of a table simple enough to read by row; asked for only while it is read so. */
  readRows?: () => TableRows<ReactNode>;
};

/** A table this many times wider than its box offers phones to read it by row. */
const WIDE_TABLE_RATIO = 1.25;

/** Each row once as label: value pairs, its first pair in bold as the row's title. */
function TableByRow({ caption, headers, rows }: TableRows<ReactNode>) {
  // Each header cell repeats per row, so only the first row displaying a column keeps anchor IDs.
  const headerOwnerRow = headers.map((_, index) => rows.findIndex((r) => index < r.length));
  // Rows have no identity of their own; a streaming table only grows at its end.
  /* eslint-disable react/no-array-index-key */
  return (
    <>
      {caption}
      <ol className={css.Rows}>
        {rows.map((cells, row) => (
          <li key={row} className={css.Row}>
            <dl className={css.Pairs}>
              {cells.map((cell, index) => (
                <div key={index} className={index === 0 ? css.RowTitle : css.Pair}>
                  <dt className={css.Label}>
                    {row !== headerOwnerRow[index] ? (
                      <FootnoteSuppressIds>{headers[index]}</FootnoteSuppressIds>
                    ) : (
                      headers[index]
                    )}
                  </dt>
                  <dd className={css.Value}>{cell}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
  /* eslint-enable react/no-array-index-key */
}

export function ScrollableTable({ children, readRows, ...props }: ScrollableTableProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [wide, setWide] = useState(false);
  const [byRowChosen, setByRowChosen] = useState(false);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const offerByRow = phone && readRows !== undefined && (wide || byRowChosen);
  const byRow = offerByRow && byRowChosen;
  const hintId = useId();
  // Read before the commit: when the reader leaves (a resize, a streamed edit), so does its focus.
  const readerFocus = useRef(false);
  const active = globalThis.document?.activeElement;
  readerFocus.current =
    !!containerRef.current?.contains(active) && !scrollRef.current?.contains(active);

  useEffect(() => {
    // The table, not its scroll area: that loses its tab stop once the table fits.
    const table = tableRef.current;
    if (!readerFocus.current || !table || document.activeElement !== document.body) return;
    if (!table.hasAttribute('tabindex')) table.tabIndex = -1;
    table.focus();
  }, [offerByRow]);

  useEffect(() => {
    const scroll = scrollRef.current;
    const table = tableRef.current;
    if (!scroll || !table) return undefined;

    const measure = () => {
      if (scroll.clientWidth === 0) return; // Hidden while read by row: keep the last widths.
      setOverflowing(scroll.scrollWidth > scroll.clientWidth + 1);
      setWide(scroll.scrollWidth > scroll.clientWidth * WIDE_TABLE_RATIO);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;

    // Watch the table too: streaming edits and loaded media can change its width.
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={css.Container}>
      {offerByRow && (
        <div className={css.Views}>
          {[true, false].map((rows) => (
            <Chip
              key={String(rows)}
              radii="Pill"
              variant={rows === byRow ? 'Primary' : 'SurfaceVariant'}
              outlined={rows !== byRow}
              aria-pressed={rows === byRow}
              onClick={() => setByRowChosen(rows)}
            >
              <Text size="T300">
                {rows
                  ? t('messageTable.readByRow', 'Read by row')
                  : t('messageTable.showTable', 'Show table')}
              </Text>
            </Chip>
          ))}
        </div>
      )}
      {/* Native scroll areas need a tab stop for keyboard scrolling. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={scrollRef}
        // Hidden while read by row, so assistive tech meets the table only once.
        hidden={byRow}
        className={css.ScrollArea}
        role={overflowing ? 'region' : undefined}
        aria-label={overflowing ? t('messageTable.label', 'Scrollable table') : undefined}
        aria-describedby={overflowing ? hintId : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        <table {...props} ref={tableRef} className={css.Table}>
          {/* Isolate hidden table copy while reading by row so only visible cells own footnote IDs. */}
          <FootnoteScopeProvider isolate={byRow}>{children}</FootnoteScopeProvider>
        </table>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
      {byRow && readRows && <TableByRow {...readRows()} />}
      {overflowing && !byRow && (
        <div id={hintId} className={css.Hint}>
          <span aria-hidden="true">↔</span>
          {t('messageTable.scrollHint', 'Scroll horizontally')}
        </div>
      )}
    </div>
  );
}
