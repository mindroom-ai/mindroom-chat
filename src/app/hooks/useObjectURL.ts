import { useEffect, useMemo } from 'react';

/** An object URL for `blob`, revoked when the blob changes or the component unmounts. */
export const useObjectURL = (blob?: Blob | null): string | undefined => {











