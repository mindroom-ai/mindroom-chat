// import { atom } from 'jotai';
// import {
//   atomWithLocalStorage,
//   getLocalStorageItem,
//   setLocalStorageItem,
// } from './utils/atomWithLocalStorage';
import type { ClientConfig } from '../hooks/useClientConfig';

export type Session = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  fallbackSdkStores?: boolean;
};

export type Sessions = Session[];
export type SessionStoreName = {
  sync: string;
  crypto: string;
};

const FALLBACK_ACCESS_TOKEN_KEY = 'cinny_access_token';
const FALLBACK_DEVICE_ID_KEY = 'cinny_device_id';
const FALLBACK_USER_ID_KEY = 'cinny_user_id';
export const FALLBACK_BASE_URL_KEY = 'cinny_hs_base_url';

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const getLocalStorageSafe = (): LocalStorageLike | undefined => {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
};

export const getSingleConfiguredHomeserver = (clientConfig: ClientConfig): string | undefined => {
  if (clientConfig.allowCustomHomeservers) return undefined;

  const { homeserverList } = clientConfig;
  if (!homeserverList || homeserverList.length !== 1) return undefined;

  const [homeserver] = homeserverList;
  if (typeof homeserver !== 'string' || homeserver.length === 0) return undefined;

  return homeserver;
};

export const reconcileFallbackSessionHomeserver = (
  clientConfig: ClientConfig,
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): boolean => {
  const configuredHomeserver = getSingleConfiguredHomeserver(clientConfig);
  if (!configuredHomeserver || !storage) return false;

  try {
    if (storage.getItem(FALLBACK_BASE_URL_KEY) === configuredHomeserver) {
      return false;
    }

    storage.setItem(FALLBACK_BASE_URL_KEY, configuredHomeserver);
    return true;
  } catch {
    return false;
  }
};

/**
 * Migration code for old session
 */
// const FALLBACK_STORE_NAME: SessionStoreName = {
//   sync: 'web-sync-store',
//   crypto: 'crypto-store',
// } as const;

export function setFallbackSession(
  accessToken: string,
  deviceId: string,
  userId: string,
  baseUrl: string
) {
  localStorage.setItem(FALLBACK_ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(FALLBACK_DEVICE_ID_KEY, deviceId);
  localStorage.setItem(FALLBACK_USER_ID_KEY, userId);
  localStorage.setItem(FALLBACK_BASE_URL_KEY, baseUrl);
}
export const removeFallbackSession = () => {
  localStorage.removeItem(FALLBACK_BASE_URL_KEY);
  localStorage.removeItem(FALLBACK_USER_ID_KEY);
  localStorage.removeItem(FALLBACK_DEVICE_ID_KEY);
  localStorage.removeItem(FALLBACK_ACCESS_TOKEN_KEY);
};
export const getFallbackSession = (): Session | undefined => {
  const baseUrl = localStorage.getItem(FALLBACK_BASE_URL_KEY);
  const userId = localStorage.getItem(FALLBACK_USER_ID_KEY);
  const deviceId = localStorage.getItem(FALLBACK_DEVICE_ID_KEY);
  const accessToken = localStorage.getItem(FALLBACK_ACCESS_TOKEN_KEY);

  if (baseUrl && userId && deviceId && accessToken) {
    const session: Session = {
      baseUrl,
      userId,
      deviceId,
      accessToken,
      fallbackSdkStores: true,
    };

    return session;
  }

  return undefined;
};
/**
 * End of migration code for old session
 */

// export const getSessionStoreName = (session: Session): SessionStoreName => {
//   if (session.fallbackSdkStores) {
//     return FALLBACK_STORE_NAME;
//   }

//   return {
//     sync: `sync${session.userId}`,
//     crypto: `crypto${session.userId}`,
//   };
// };

// export const MATRIX_SESSIONS_KEY = 'matrixSessions';
// const baseSessionsAtom = atomWithLocalStorage<Sessions>(
//   MATRIX_SESSIONS_KEY,
//   (key) => {
//     const defaultSessions: Sessions = [];
//     const sessions = getLocalStorageItem(key, defaultSessions);

//     // Before multi account support session was stored
//     // as multiple item in local storage.
//     // So we need these migration code.
//     const fallbackSession = getFallbackSession();
//     if (fallbackSession) {
//       removeFallbackSession();
//       sessions.push(fallbackSession);
//       setLocalStorageItem(key, sessions);
//     }
//     return sessions;
//   },
//   (key, value) => {
//     setLocalStorageItem(key, value);
//   }
// );

// export type SessionsAction =
//   | {
//       type: 'PUT';
//       session: Session;
//     }
//   | {
//       type: 'DELETE';
//       session: Session;
//     };

// export const sessionsAtom = atom<Sessions, [SessionsAction], undefined>(
//   (get) => get(baseSessionsAtom),
//   (get, set, action) => {
//     if (action.type === 'PUT') {
//       const sessions = [...get(baseSessionsAtom)];
//       const sessionIndex = sessions.findIndex(
//         (session) => session.userId === action.session.userId
//       );
//       if (sessionIndex === -1) {
//         sessions.push(action.session);
//       } else {
//         sessions.splice(sessionIndex, 1, action.session);
//       }
//       set(baseSessionsAtom, sessions);
//       return;
//     }
//     if (action.type === 'DELETE') {
//       const sessions = get(baseSessionsAtom).filter(
//         (session) => session.userId !== action.session.userId
//       );
//       set(baseSessionsAtom, sessions);
//     }
//   }
// );
