import { useEffect, useState } from 'react';
import { MatrixEvent, User, UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

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









    ...readUser(mx.getUser(userId)),
    isDisplayNameResolved: false,
    isAvatarResolved: false,
  }));

  useEffect(() => {
    let disposed = false;
    setProfile({
      ...readUser(mx.getUser(userId)),
      isDisplayNameResolved: false,
      isAvatarResolved: false,
    });

    mx.getProfileInfo(userId)
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
    mx.on(UserEvent.DisplayName, handleDisplayName);
    mx.on(UserEvent.AvatarUrl, handleAvatarUrl);
    return () => {
      disposed = true;
      mx.removeListener(UserEvent.DisplayName, handleDisplayName);
      mx.removeListener(UserEvent.AvatarUrl, handleAvatarUrl);
    };
  }, [mx, userId]);

  return profile;
};
