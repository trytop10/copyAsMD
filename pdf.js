// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Must match the key used by background.js.
const PENDING_PDF_KEY = 'pendingPdfExport';

// Chrome exposes the callback-based `chrome.*` API while Firefox exposes the
// promise-based `browser.*` API. Normalise both to promises.
const isPromiseApi = typeof browser !== 'undefined';

function getStoredValue(key) {
  if (isPromiseApi) {
    return browserAPI.storage.local.get(key);
  }
  return new Promise((resolve) => browserAPI.storage.local.get(key, resolve));
}

function removeStoredValue(key) {
  if (isPromiseApi) {
    return browserAPI.storage.local.remove(key);
  }
  return new Promise((resolve) => browserAPI.storage.local.remove(key, resolve));
}

// Escape raw HTML so a page cannot inject markup into this extension page
// through the exported Markdown.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Raw HTML (both block and inline) is rendered as plain text. marked does not
// expose a separate inline renderer, so a single `html` override covers both.
marked.use({
  renderer: {
    html: ({ text }) => escapeHtml(text)
  }
});

// Wait until every image and web font has settled before printing, otherwise
// the print dialog can capture placeholders.
function waitForResources() {
  const pendingImages = Array.from(document.images)
    .filter((image) => !image.complete)
    .map((image) => new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }));

  const fontsReady = document.fonts && document.fonts.ready
    ? document.fonts.ready
    : Promise.resolve();

  return Promise.all([...pendingImages, fontsReady]);
}

// Read the Markdown handed over by the background page, render it and open
// the browser print dialog so the user can save the result as a PDF.
async function renderAndPrint() {
  const container = document.getElementById('content');
  const result = await getStoredValue(PENDING_PDF_KEY);
  const payload = result && result[PENDING_PDF_KEY];

  // The payload is single-use: drop it so a refresh does not print again.
  await removeStoredValue(PENDING_PDF_KEY);

  if (!payload || !payload.markdown) {
    container.innerHTML = '<p>No content to export.</p>';
    return;
  }

  document.title = payload.title || 'Document';
  container.innerHTML = marked.parse(payload.markdown);

  await waitForResources();
  window.print();
}

renderAndPrint();

// Let the user print again if they dismissed the automatic print dialog.
const printButton = document.getElementById('print-button');
if (printButton) {
  printButton.addEventListener('click', () => window.print());
}

