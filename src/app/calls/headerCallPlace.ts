import { createContext } from 'react';

// Set while a thread fills a phone's page, whose header row holds one call button: the row
// (`{}`) keeps the room's call before an agent's, and the room menu (`closeMenu`) lists the
// agents the row left out.
export const PhoneThreadCallPlace = createContext<{ closeMenu?: () => void } | undefined>(
  undefined
);
