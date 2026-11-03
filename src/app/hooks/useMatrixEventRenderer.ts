import { ReactNode, useCallback } from 'react';

/** Renders one event; `T` is the argument list the caller passes for every event. */





















    (eventType: string, isStateEvent: boolean, ...args: T) => {
      const renderer = typeToRenderer[eventType];
      if (renderer) return renderer(...args);
      if (isStateEvent && renderStateEvent) return renderStateEvent(...args);
      if (!isStateEvent && renderEvent) return renderEvent(...args);
      return null;
    },
    [typeToRenderer, renderStateEvent, renderEvent]
  );
