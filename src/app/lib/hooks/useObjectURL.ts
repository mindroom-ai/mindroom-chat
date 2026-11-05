import { useEffect, useMemo } from 'react';

/** An object URL for `blob`, revoked when the blob changes or the component unmounts. */
export const useObjectURL = (blob?: Blob | null): string | undefined => {
  const objectUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);

  useEffect(() => {
    if (objectUrl === undefined) return undefined;
    const revoke = () => URL.revokeObjectURL(objectUrl);
    return revoke;
  }, [objectUrl]);

  return objectUrl;
};
