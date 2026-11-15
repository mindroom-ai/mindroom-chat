import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { tourAtom } from '../navigation/tourState';
import { TourDialog } from './TourDialog';
import { TourHandoff } from './TourHandoff';

/**
 * The interface tour's dialog while the tour is open, and after its Done the handoff to the open
 * room's composer. Closing the tour any other way just closes it.
 */
export function TourRenderer() {
  const [tour, setTour] = useAtom(tourAtom);
  const [handoff, setHandoff] = useState(false);
  // A tour that opens while a handoff still plays ends that handoff: only its own Done hands over.
  useEffect(() => {
    if (tour) setHandoff(false);
  }, [tour]);

  if (tour) {
    return (
      <TourDialog
        level={tour.level}
        onLevelChange={(level) => setTour({ level })}
        onClose={(how) => {
          setTour(undefined);
          // The dialog also reports its own unmounting as dismissed, which takes nothing back.
          if (how === 'done') setHandoff(true);
        }}
      />
    );
  }
  return handoff ? <TourHandoff onEnd={() => setHandoff(false)} /> : null;
}
