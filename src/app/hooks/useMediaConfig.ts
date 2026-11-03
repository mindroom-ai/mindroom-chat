import { createContext, useContext } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/** The homeserver's media configuration (`GET /_matrix/client/v1/media/config`). */
export type MediaConfig = Awaited<ReturnType<MatrixClient['getMediaConfig']>>;









  return mediaConfig;
}
