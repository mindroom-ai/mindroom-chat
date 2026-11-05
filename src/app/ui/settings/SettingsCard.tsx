import { ReactNode } from 'react';
import { SequenceCard } from '../sequence-card';
import { SequenceCardStyle } from './styles.css';

/** The padded card that holds the tiles of one group on a settings page. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      {children}
    </SequenceCard>
  );
}
