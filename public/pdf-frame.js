(function showPdf() {
  // A frame whose URL changes only after the # sign stays on this page: show the new one.
  window.addEventListener('hashchange', function () {
    window.location.reload();
  });
  var pdfUrl = decodeURIComponent(window.location.hash.slice(1));
  if (pdfUrl.indexOf('blob:' + window.location.origin + '/') !== 0) return;
  fetch(pdfUrl)
    .then(function (response) {
      return response.blob();
    })
    .then(function (blob) {
      var viewer = document.createElement('embed');
      viewer.type = 'application/pdf';
      viewer.src = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      document.body.appendChild(viewer);
    });
})();
