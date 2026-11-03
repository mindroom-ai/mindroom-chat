import React, { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

// Kept out of sight and out of the layout: the cards already show the threads, and the count is
// for assistive technology (and the specs) that read the overview as text.
const OFF_SCREEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/** How many threads the Compact overview lists, as a line of text before the cards. */
export function CompactThreadCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <p style={OFF_SCREEN}>
      {t('mindroomUi.threads.roomThreadOverview.showingAllThreads', { count })}
    </p>
  );
}
