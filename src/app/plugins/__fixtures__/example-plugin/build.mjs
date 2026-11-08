// The example plugin's build module (docs/architecture.md "Client plugins"): the build runs its
// transform on the plugin's own modules, where it writes the banner's words in place of a marker.
// The two are as long, so that no code moves and `map: null` keeps the source map as it is.
/** @type {import('vite').Plugin} */
export default {
  name: 'example-banner-words',
  transform: (code) =>
    code.includes('EXAMPLE_BANNER')
      ? { code: code.replaceAll('EXAMPLE_BANNER', 'Example banner'), map: null }
      : null,
};
