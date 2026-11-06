import { Icons, Line } from 'folds';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { getCanvasesPath, getThreadsPath } from '../../routes/pathUtils';
import { type RailButton, useOfferedRailButtons, useRailButtons } from '../../settings/railButtons';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import { useOpenCreateSpaceModal } from '../../navigation/useCreateSpaceModal';
import { useHasCanvases } from '../rail/CanvasesTab';
import { useOpenExplore } from '../rail/useOpenExplore';

/**
 * The rail buttons the person hides (Settings > General > Sidebar), in rail order, so each stays
 * one menu away on any screen: Threads, Canvases (once there is one, as for its button), Explore
 * Community, Create Space and Search (the command palette).
 */
export function HiddenRailPages({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offered = useOfferedRailButtons();
  const shown = useRailButtons();
  const openExplore = useOpenExplore();
  const openCreateSpace = useOpenCreateSpaceModal();
  const openCommandPalette = useSetAtom(commandPaletteOpenAtom);
  const hasCanvases = useHasCanvases();
  const hidden = (button: RailButton) => offered[button] && !shown[button];
  const threads = hidden('threads');
  const canvases = hidden('canvases') && hasCanvases;
  const explore = hidden('explore');
  const createSpace = hidden('createSpace');
  const search = hidden('search');
  if (!threads && !canvases && !explore && !createSpace && !search) return null;

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
        {canvases && (
          <MenuEntry
            icon={Icons.Category}
            label={t('nav.canvases')}
            onSelect={closeThen(() => navigate(getCanvasesPath()))}
          />
        )}
        {explore && (
          <MenuEntry
            icon={Icons.Explore}
            label={t('nav.exploreCommunity')}
            onSelect={closeThen(openExplore)}
          />
        )}
        {createSpace && (
          <MenuEntry
            icon={Icons.Plus}
            label={t('nav.createSpace')}
            onSelect={closeThen(() => openCreateSpace())}
          />
        )}
        {search && (
          <MenuEntry
            icon={Icons.Search}
            label={t('featureUi.homeNav.search')}
            onSelect={closeThen(() => openCommandPalette('all'))}
          />
        )}
      </MenuGroup>
    </>
  );
}
