import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { recoveryDialogAtom } from '../account/encryption/recoveryDialog';
import { tourAtom, type TourLevel } from '../navigation/tourState';
import { TourDialog } from './TourDialog';
import { TourHandoff } from './TourHandoff';

type Opening = {
  /** What an entry put into the atom to open the tour; another one is another opening. */
  tour: { level: TourLevel };
  /** The level now: the one it opened at, or Full after Keep going. */
  level: TourLevel;
  /** Which opening of this page it is, so each one is a dialog of its own. */
  run: number;
};

/**
 * The interface tour's dialog while the tour is open, and after its Done the handoff to the open
 * room's composer. Closing the tour any other way just closes it. A tour opened while one is open
 * (from the command palette, which opens over it) starts over at its first step.
 */
export function TourRenderer() {
  const [tour, setTour] = useAtom(tourAtom);
  const [handoff, setHandoff] = useState(false);
  // A tour that opens while a handoff still plays ends that handoff: only its own Done hands
  // over. So does the recovery password dialog, which waits for the tour to close and then opens
  // over the room: the ring would pulse on top of it, and the composer under it takes no typing.
  const recoveryOpen = useAtomValue(recoveryDialogAtom) !== undefined;
  useEffect(() => {
    if (tour || recoveryOpen) setHandoff(false);
  }, [tour, recoveryOpen]);

  // The opening follows the atom in the render that brings a new one, so no step of the tour
  // before it shows under the new level.
  const [opening, setOpening] = useState<Opening>();
  let open = opening;
  if (tour && opening?.tour !== tour) {
    open = { tour, level: tour.level, run: (opening?.run ?? 0) + 1 };
    setOpening(open);
  }

  if (tour && open) {
    const { run } = open;
    return (
      <TourDialog
        key={run}
        level={open.level}
        onLevelChange={(level) => setOpening((now) => (now?.run === run ? { ...now, level } : now))}
        onClose={(how) => {
          setTour(undefined);
          if (how === 'done') setHandoff(true);
        }}
      />
    );
  }
  return handoff && !recoveryOpen ? <TourHandoff onEnd={() => setHandoff(false)} /> : null;
}
