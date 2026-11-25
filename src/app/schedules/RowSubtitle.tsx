import { Fragment, type ReactNode } from 'react';
import { Text } from 'folds';
import * as css from './roomSchedules.css';

/** Dot-separated subtitle line shared by scheduled task and room trigger rows. */
export function RowSubtitle({ parts }: { parts: readonly ReactNode[] }) {
  return (
    <span className={css.RowSubtitle}>
      {parts.map((node, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className={css.SubtitleDot} aria-hidden="true">
              ·
            </span>
          )}
          <Text as="span" size="T200" className={css.Wrap}>
            {node}
          </Text>
        </Fragment>
      ))}
    </span>
  );
}
