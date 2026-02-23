const MEDIA_REQUEST_PATHS = [
  '/_matrix/client/v1/media/download',
  '/_matrix/client/v1/media/thumbnail',
] as const;

const isMediaPathname = (pathname: string): boolean =>
  MEDIA_REQUEST_PATHS.some((path) => pathname.includes(path));

const parseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export const looksLikeMediaRequest = (url: string): boolean => {
  const parsedUrl = parseUrl(url);
  if (parsedUrl) return isMediaPathname(parsedUrl.pathname);

  return MEDIA_REQUEST_PATHS.some((path) => url.includes(path));
};

export const validMediaRequest = (url: string, baseUrl: string): boolean => {
  const parsedRequestUrl = parseUrl(url);
  const parsedBaseUrl = parseUrl(baseUrl);

  if (!parsedRequestUrl || !parsedBaseUrl) return false;
  if (parsedRequestUrl.origin !== parsedBaseUrl.origin) return false;

  return isMediaPathname(parsedRequestUrl.pathname);
};
