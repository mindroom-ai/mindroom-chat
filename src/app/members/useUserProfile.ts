import { useEffect, useState } from 'react';
import { MatrixEvent, User, UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

type UserProfile = {
  displayName?: string;
  /** The `mxc://` avatar URL. */
  avatarUrl?: string;
  /** False until the profile was read from the server or a presence update. */
  isDisplayNameResolved: boolean;
  isAvatarResolved: boolean;
};

const readUser = (
  user: User | null | undefined
): Pick<UserProfile, 'displayName' | 'avatarUrl'> => ({
  displayName: user?.displayName || undefined,
  avatarUrl: user?.avatarUrl || undefined,
});

/**
 * A user's display name and avatar: the cached user first, then the server profile, then live
 * presence updates. The resolved flags tell a placeholder apart from a profile that is empty.
 */
export const useUserProfile = (userId: string): UserProfile => {
  const client = useMatrixClient();
  const [profile, setProfile] = useState<UserProfile>(() => ({
    ...readUser(client.getUser(userId)),
    isDisplayNameResolved: false,
    isAvatarResolved: false,
  }));

  useEffect(() => {
    let disposed = false;
    setProfile({
      ...readUser(client.getUser(userId)),
      isDisplayNameResolved: false,
      isAvatarResolved: false,
    });

    client
      .getProfileInfo(userId)
      .then((info) => {
        if (disposed) return;
        setProfile({
          displayName: info.displayname || undefined,
          avatarUrl: info.avatar_url || undefined,
          isDisplayNameResolved: true,
          isAvatarResolved: true,
        });
      })
      .catch(() => {
        if (disposed) return;
        setProfile((current) => ({
          ...current,
          isDisplayNameResolved: true,
          isAvatarResolved: true,
        }));
      });

    const handleDisplayName = (_event: MatrixEvent | undefined, user: User) => {
      if (user.userId !== userId) return;
      setProfile((current) => ({
        ...current,
        displayName: user.displayName || undefined,
        isDisplayNameResolved: true,
      }));
    };
    const handleAvatarUrl = (_event: MatrixEvent | undefined, user: User) => {
      if (user.userId !== userId) return;
      setProfile((current) => ({
        ...current,
        avatarUrl: user.avatarUrl || undefined,
        isAvatarResolved: true,
      }));
    };
    client.on(UserEvent.DisplayName, handleDisplayName);
    client.on(UserEvent.AvatarUrl, handleAvatarUrl);
    return () => {
      disposed = true;
      client.removeListener(UserEvent.DisplayName, handleDisplayName);
      client.removeListener(UserEvent.AvatarUrl, handleAvatarUrl);
    };
  }, [client, userId]);

  return profile;
};
