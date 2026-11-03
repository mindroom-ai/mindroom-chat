import { useEffect, useMemo, useState } from 'react';
import { Relations, RelationsEvent } from 'matrix-js-sdk/lib/models/relations';

/**
 * Reads `select(relations)` and reads it again when a relation is added, removed or
 * redacted, or when the caller passes another relations object.
 */
export const useRelations = <T>(relations: Relations, select: (relations: Relations) => T): T => {
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
    return select(relations);
  }, [relations, select, version]);
};
