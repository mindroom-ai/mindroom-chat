import { ComponentPropsWithoutRef, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, Text } from 'folds';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import type { TableRows } from './tableRows';
import * as css from './ScrollableTable.css';

type ScrollableTableProps = ComponentPropsWithoutRef<'table'> & {
  /** The cells of a table simple enough to read by row; asked for only while it is read so. */
  readRows?: () => TableRows<ReactNode>;
};

/** A table this many times wider than its box offers phones to read it by row. */
const WIDE_TABLE_RATIO = 1.25;

/** Each row once, its first cell as the title, then its other cells as label: value pairs. */
function TableByRow({ caption, headers, rows }: TableRows<ReactNode>) {
  // Rows have no identity of their own; a streaming table only grows at its end.
  /* eslint-disable react/no-array-index-key */
  return (
    <>
      {caption}
      <ol className={css.Rows}>
        {rows.map((cells, row) => (
          <li key={row} className={css.Row}>
            <div className={css.RowTitle}>{cells[0]}</div>
            <dl className={css.Pairs}>
              {cells.slice(1).map((cell, index) => (
                <div key={index} className={css.Pair}>
                  <dt className={css.Label}>{headers[index + 1]}</dt>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [wide, setWide] = useState(false);
  const [byRowChosen, setByRowChosen] = useState(false);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const offerByRow = phone && readRows !== undefined && (wide || byRowChosen);
  const byRow = offerByRow && byRowChosen;
  const hintId = useId();

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
    <div className={css.Container}>
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
          {children}
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
