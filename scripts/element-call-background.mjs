export const transparentCallBackground =
  '<style>html,body{background:transparent!important}</style>';

export const installElementCallDiscoveryBridge = (
  windowObject,
  Url,
  UrlSearchParams,
  ResponseConstructor
) => {
  const currentUrl = new Url(windowObject.location.href);
  const fragment = new UrlSearchParams(currentUrl.hash.slice(1));
  const livekitServiceUrl = fragment.get('livekitServiceUrl');
  const baseUrl = currentUrl.searchParams.get('baseUrl');
  const userId = currentUrl.searchParams.get('userId');
  const serverSeparator = userId?.indexOf(':') ?? -1;

  if (!livekitServiceUrl || !baseUrl || !userId || serverSeparator < 1) return;

  let parsedLivekitServiceUrl;
  let parsedBaseUrl;
  let discoveryUrl;
  try {
    parsedLivekitServiceUrl = new Url(livekitServiceUrl);
    parsedBaseUrl = new Url(baseUrl);
    const serverName = userId.slice(serverSeparator + 1);
    discoveryUrl = new Url(`https://${serverName}/.well-known/matrix/client`).href;
  } catch {
    return;
  }

  if (!['http:', 'https:'].includes(parsedLivekitServiceUrl.protocol)) return;
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) return;

  const originalFetch = windowObject.fetch.bind(windowObject);
  windowObject.fetch = (input, init) => {
    let requestedUrl;
    try {
      const value = typeof input === 'string' ? input : input?.url;
      requestedUrl = new Url(value, currentUrl).href;
    } catch {
      return originalFetch(input, init);
    }

    if (requestedUrl !== discoveryUrl) return originalFetch(input, init);

    return Promise.resolve(
      new ResponseConstructor(
        JSON.stringify({
          'm.homeserver': {
            base_url: parsedBaseUrl.href.endsWith('/')
              ? parsedBaseUrl.href.slice(0, -1)
              : parsedBaseUrl.href,
          },
          'org.matrix.msc4143.rtc_foci': [
            {
              type: 'livekit',
              livekit_service_url: parsedLivekitServiceUrl.href,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  };
};

export const elementCallDiscoveryBridgeSource = `(${installElementCallDiscoveryBridge.toString()})(window, URL, URLSearchParams, Response);`;

export const elementCallDiscoveryBridge = `<script data-cinny-discovery-bridge>${elementCallDiscoveryBridgeSource}</script>`;

export const injectElementCallTransparentBackground = (html) => {
  if (!html.includes('<head>')) {
    throw new Error('Element Call index is missing its <head> element');
  }
  return html.replace('<head>', `<head>${transparentCallBackground}${elementCallDiscoveryBridge}`);
};

export const assertElementCallTransparentBackground = (html) => {
  if (!html.includes(transparentCallBackground)) {
    throw new Error('Built Element Call index is missing its transparent background override');
  }
};

export const assertElementCallDiscoveryBridge = (html) => {
  const requiredParts = [
    '<script data-cinny-discovery-bridge>',
    '/.well-known/matrix/client',
    'org.matrix.msc4143.rtc_foci',
  ];
  if (!requiredParts.every((part) => html.includes(part))) {
    throw new Error('Built Element Call index is missing its configured discovery bridge');
  }
};
