import { Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import * as css from './CompactRoomView.css';
import type { CompactThreadSectionId } from './compactThreadSections';

export type CompactSectionHeaderProps = {
  id: CompactThreadSectionId;
  count: number;
  closed: boolean;
  fixedOpen?: boolean;
  onToggle: (id: CompactThreadSectionId) => void;
  motionRow?: string;
};

/** Collapsible workflow section header shared by Compact room views and Space Threads. */
export function CompactSectionHeader({
  id,
  count,
  closed,
  fixedOpen = false,
  onToggle,
  motionRow,
}: CompactSectionHeaderProps) {
  const { t } = useTranslation();
  const label = <Text size="B300">{`${t(`thread.workflow.${id}`)} · ${count}`}</Text>;
  return (
    <div className={css.SectionHeader} data-motion-row={motionRow} data-compact-section={id}>
      {fixedOpen ? (
        <Button as="div" size="300" variant="Secondary" fill="None" radii="300">
          {label}
        </Button>
      ) : (
        <Button
          size="300"
          variant="Secondary"
          fill="None"
          radii="300"
          aria-expanded={!closed}
          onClick={() => onToggle(id)}
          before={
            <Icon
              size="100"
              src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
              data-directional={closed || undefined}
            />
          }
        >
          {label}
        </Button>
      )}
    </div>
  );
}
