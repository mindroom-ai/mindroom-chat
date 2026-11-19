import { ComponentPropsWithoutRef, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, Text } from 'folds';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import type { TableRows } from './tableRows';
import * as css from './ScrollableTable.css';

type ScrollableTableProps = ComponentPropsWithoutRef<'table'> & {
  /** The cells of a table simple enough to read row by row; asked for only while it is read so. */
  readRows?: () => TableRows<ReactNode>;
};

/** A table wider than this many times its box offers a phone reader to read it by row. */
const WIDE_TABLE_RATIO = 1.25;

type Overflow = 'none' | 'some' | 'wide';

function TableByRow({ caption, headers, rows }: TableRows<ReactNode>) {
  return (
    <>
      {caption !== undefined && <div className={css.Caption}>{caption}</div>}
      <ol className={css.Rows}>
        {rows.map((cells, row) => (
          // Rows have no identity of their own; a streaming table only grows at its end.
          // eslint-disable-next-line react/no-array-index-key
          <li key={row} className={css.Row}>
            <div className={css.RowTitle}>{cells[0]}</div>
            <dl className={css.Pairs}>
              {cells.slice(1).map((cell, index) => (
                // eslint-disable-next-line react/no-array-index-key
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
}

export function ScrollableTable({ children, readRows, ...props }: ScrollableTableProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflow, setOverflow] = useState<Overflow>('none');
  const [byRowChosen, setByRowChosen] = useState(false);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const hintId = useId();
  const overflowing = overflow !== 'none';
  // Only one view is mounted, so assistive tech never meets the table twice.
  const offerByRow = phone && readRows !== undefined && (overflow === 'wide' || byRowChosen);
  const byRow = offerByRow && byRowChosen;

  useEffect(() => {
    const scroll = scrollRef.current;
    const table = tableRef.current;
    if (!scroll || !table) return undefined;

    const measure = () => {
      const { scrollWidth, clientWidth } = scroll;
      if (scrollWidth > clientWidth * WIDE_TABLE_RATIO) setOverflow('wide');
      else setOverflow(scrollWidth > clientWidth + 1 ? 'some' : 'none');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;

    // Watch the table too: streaming edits and loaded media can change its width.
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(table);
    return () => observer.disconnect();
  }, [byRow]);

  return (
    <div className={css.Container}>
      {offerByRow && (
        <div className={css.Views}>
          <Chip
            type="button"
            radii="Pill"
            variant={byRow ? 'Primary' : 'SurfaceVariant'}
            outlined={!byRow}
            aria-pressed={byRow}
            onClick={() => setByRowChosen(true)}
          >
            <Text size="T300">{t('messageTable.readByRow', 'Read by row')}</Text>
          </Chip>
          <Chip
            type="button"
            radii="Pill"
            variant={byRow ? 'SurfaceVariant' : 'Primary'}
            outlined={byRow}
            aria-pressed={!byRow}
            onClick={() => setByRowChosen(false)}
          >
            <Text size="T300">{t('messageTable.showTable', 'Show table')}</Text>
          </Chip>
        </div>
      )}
      {byRow && readRows ? (
        <TableByRow {...readRows()} />
      ) : (
        <>
          {/* Native scroll areas need a tab stop for keyboard scrolling. */}
          {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
          <div
            ref={scrollRef}
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
          {overflowing && (
            <div id={hintId} className={css.Hint}>
              <span aria-hidden="true">↔</span>
              {t('messageTable.scrollHint', 'Scroll horizontally')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
