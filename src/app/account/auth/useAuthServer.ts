import { createContext, useContext } from 'react';

const AuthServerContext = createContext<string | null>(null);

/** Set by the sign-in layout to the server the user picked, as they typed it. */
export const AuthServerProvider = AuthServerContext.Provider;

/** The server the signed-out pages work with, such as `mindroom.chat` or a full URL. */
export function useAuthServer(): string {
  const server = useContext(AuthServerContext);
  if (server === null) throw new Error('useAuthServer is used outside the sign-in layout.');
  return server;
}
