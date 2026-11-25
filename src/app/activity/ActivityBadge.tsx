import { useTranslation } from 'react-i18next';
import { Badge, Text } from 'folds';
import { formatBadgeCount, UnreadBadge } from '../ui/UnreadBadge';

/** The bell's count: red while something waits for an answer, else the quiet unread chip. */
export function ActivityBadge({ count, needsYou }: { count: number; needsYou: boolean }) {
  const { i18n } = useTranslation();
  if (!needsYou) return <UnreadBadge count={count} />;
  return (
    <Badge variant="Critical" fill="Solid" radii="Pill" size="400" data-activity-badge="needs-you">
      <Text as="span" size="L400">
        {formatBadgeCount(count, i18n.language)}
      </Text>
    </Badge>
  );
}
