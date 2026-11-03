import { useEffect, useMemo, useState } from 'react';
import { Relations, RelationsEvent } from 'matrix-js-sdk/lib/models/relations';

/**
 * Reads `getRelations(relations)` and reads it again when a relation is added, removed or
 * redacted, or when the caller passes another relations object.
 */



): T => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((current) => current + 1);
    relations.on(RelationsEvent.Add, refresh);
    relations.on(RelationsEvent.Remove, refresh);
    relations.on(RelationsEvent.Redaction, refresh);
    return () => {
      relations.removeListener(RelationsEvent.Add, refresh);
      relations.removeListener(RelationsEvent.Remove, refresh);
      relations.removeListener(RelationsEvent.Redaction, refresh);
    };
  }, [relations]);

  return useMemo(() => {
    void version;
    return getRelations(relations);
  }, [relations, getRelations, version]);
};
