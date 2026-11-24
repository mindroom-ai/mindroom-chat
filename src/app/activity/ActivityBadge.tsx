import { Badge, Text } from 'folds';
import { UnreadBadge } from '../ui/UnreadBadge';

/** The bell's count: red while something waits for an answer, else the quiet unread chip. */
export function ActivityBadge({ count, needsYou }: { count: number; needsYou: boolean }) {
  if (!needsYou) return <UnreadBadge count={count} />;
  return (
    <Badge variant="Critical" fill="Solid" radii="Pill" size="400" data-activity-badge="needs-you">
      <Text as="span" size="L400">
        {count > 99 ? '99+' : count}
      </Text>
    </Badge>
  );
}
