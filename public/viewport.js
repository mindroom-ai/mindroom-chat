document.querySelector('meta[name="viewport"]').content +=
  !/AppleWebKit/.test(navigator.userAgent) || /Chrome\//.test(navigator.userAgent)
    ? ', interactive-widget=resizes-content'
    : ', maximum-scale=1';
