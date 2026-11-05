import { Icons, Line } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { getThreadsPath } from '../../routes/pathUtils';
import { useOfferedRailButtons, useRailButtons } from '../../settings/railButtons';
import { useOpenExplore } from '../rail/useOpenExplore';

/**
 * Threads and Explore Community while the person hides their rail buttons (Settings > General >
 * Sidebar), so both pages stay one menu away.
 */
export function HiddenRailPages({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offered = useOfferedRailButtons();
  const shown = useRailButtons();
  const openExplore = useOpenExplore();
  const threads = offered.threads && !shown.threads;
  const explore = offered.explore && !shown.explore;
  if (!threads && !explore) return null;

  const closeThen = (open: () => void) => () => {
    onClose();
    open();
  };
  return (
    <>
      <Line variant="Surface" size="300" />
      <MenuGroup>
        {threads && (
          <MenuEntry
            icon={Icons.Thread}
            label={t('nav.threads')}
            onSelect={closeThen(() => navigate(getThreadsPath()))}
          />
        )}
        {explore && (
          <MenuEntry
            icon={Icons.Explore}
            label={t('nav.exploreCommunity')}
            onSelect={closeThen(openExplore)}
          />
        )}
      </MenuGroup>
    </>
  );
}
