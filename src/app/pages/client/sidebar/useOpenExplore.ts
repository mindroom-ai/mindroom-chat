import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { getMxIdServer } from '../../../utils/matrix';
import {
  getExploreFeaturedPath,
  getExplorePath,
  getExploreServerPath,
  joinPathComponent,
} from '../../pathUtils';

/**
 * Opens Explore where it was left, else at the featured communities when the deployment opens
 * them first, else at the account's own server. On phones it opens the Explore list itself.
 */
export function useOpenExplore(): () => void {
  const client = useMatrixClient();
  const navigate = useNavigate();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const { featuredCommunities } = useClientConfig();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());

  return () => {
    if (isMobile) {
      navigate(getExplorePath());
      return;
    }
    const lastPath = navToActivePath.get('explore');
    if (lastPath) {
      navigate(joinPathComponent(lastPath));
      return;
    }
    if (featuredCommunities?.openAsDefault) {
      navigate(getExploreFeaturedPath());
      return;
    }
    const server = getMxIdServer(client.getUserId() ?? '');
    navigate(server ? getExploreServerPath(server) : getExploreFeaturedPath());
  };
}
