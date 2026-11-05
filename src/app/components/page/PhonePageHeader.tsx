import { Text } from 'folds';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { PageHeader } from './Page';
import { PhoneBackButton } from './PhoneBackButton';

/**
 * The title bar of a page that has none beside its section's list (room creation, message
 * search): on phones, where the page fills the screen, it names the page and leads back.
 */
export function PhonePageHeader({ to, title }: { to: string; title: string }) {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  if (!phone) return null;
  return (
    <PageHeader balance>
      <PhoneBackButton to={to} />
      <Text size="H4" truncate style={{ flexGrow: 1, minWidth: 0 }}>
        {title}
      </Text>
    </PageHeader>
  );
}
