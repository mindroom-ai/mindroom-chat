import { Chip, Icon, Text, type IconSrc } from 'folds';
import { FloatingActionStyle } from './FloatingAction.css';

/** A pill over the timeline that takes the reader somewhere or settles the unread state. */
export function FloatingAction({
  icon,
  label,
  onSelect,
  primary = false,
}: {
  icon: IconSrc;
  label: string;
  onSelect: () => void;
  primary?: boolean;
}) {
  return (
    <Chip
      className={FloatingActionStyle}
      onClick={onSelect}
      variant={primary ? 'Primary' : 'SurfaceVariant'}
      outlined
      radii="Pill"
      before={<Icon src={icon} size="50" />}
    >
      <Text size="L400" style={{ textWrap: 'balance' }}>
        {label}
      </Text>
    </Chip>
  );
}
