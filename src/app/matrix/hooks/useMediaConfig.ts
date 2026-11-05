import { createContext, useContext } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/** The homeserver's media configuration (`GET /_matrix/client/v1/media/config`). */
export type MediaConfig = Awaited<ReturnType<MatrixClient['getMediaConfig']>>;

// ClientRoot provides the loaded configuration; an empty object means no limits are known.
const MediaConfigContext = createContext<MediaConfig>({});

export const MediaConfigProvider = MediaConfigContext.Provider;

/** The media configuration of the signed-in homeserver, such as its upload size limit. */
export const useMediaConfig = (): MediaConfig => useContext(MediaConfigContext);
