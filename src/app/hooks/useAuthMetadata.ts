import { createContext, useContext } from 'react';
import type { ValidatedAuthMetadata } from 'matrix-js-sdk';

// ClientRoot provides what it loaded at sign-in; undefined when the homeserver does not delegate
// accounts to an OAuth 2.0 provider (MSC2965), which most homeservers answer with a 404.






  useContext(AuthMetadataContext);
