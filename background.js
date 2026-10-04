// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Storage key used to hand the selected Markdown over to the print page.
const PENDING_PDF_KEY = 'pendingPdfExport';

// Content script files, in load order, used for on-demand injection.
const CONTENT_SCRIPT_FILES = [
  'vendor/turndown.js',
  'vendor/turndown-plugin-gfm.js',
  'content.js'
];

// Chrome exposes the callback-based `chrome.*` API while Firefox exposes the
// promise-based `browser.*` API. This flag picks the right calling convention
// so the helpers below can always speak promises.
const isPromiseApi = typeof browser !== 'undefined';

function sendMessageToTab(tabId, message) {
  if (isPromiseApi) {
    return browserAPI.tabs.sendMessage(tabId, message);
  }
  return new Promise((resolve, reject) => {
    browserAPI.tabs.sendMessage(tabId, message, (response) => {
      const error = browserAPI.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(response);
    });
  });
}

// Send a message and turn "no receiver in that tab" into a plain undefined
// result instead of an unhandled promise rejection.
function trySendMessage(tabId, message) {
  return sendMessageToTab(tabId, message).catch(() => undefined);
}

// Ask for the active tab of the current window.
function queryActiveTab() {
  if (isPromiseApi) {
    return browserAPI.tabs.query({ active: true, currentWindow: true });
  }
  return new Promise((resolve) => {
    browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs || []);
    });
  });
}

// The tab the menu was opened on is normally passed to the context-menu click
// handler. Firefox can hand over `null` when the event is delivered while the
// background script is still starting up, and Chrome can pass a placeholder
// whose id is unusable. Fall back to the active tab in both cases so the
// action still has a target to talk to.
async function resolveTab(tab) {
  if (tab && typeof tab.id === 'number' && tab.id >= 0) {
    return tab;
  }

  const tabs = await queryActiveTab();
  return tabs && tabs.length ? tabs[0] : null;
}

// Inject the content script into a tab that does not have it yet, for example
// a tab that was already open when the extension was installed or reloaded.
function injectContentScript(tabId) {
  // Manifest V2 exposes tabs.executeScript, Manifest V3 the scripting API.
  if (browserAPI.tabs && browserAPI.tabs.executeScript) {
    return CONTENT_SCRIPT_FILES.reduce((chain, file) => {
      return chain.then(() => browserAPI.tabs.executeScript(tabId, { file }));
    }, Promise.resolve());
  }

  return Promise.resolve(browserAPI.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  }));
}

// Make sure the tab can answer our messages before sending one. This is what
// makes the extension work in tabs that were open before it was loaded.
async function ensureContentScript(tabId) {
  const pong = await trySendMessage(tabId, { action: 'ping' });
  if (pong && pong.ready) return true;

  try {
    await injectContentScript(tabId);
  } catch (err) {
    // Pages such as chrome://, the Web Store or PDF viewers cannot be scripted.
    console.error('Could not inject the content script:', err.message);
    return false;
  }

  const rechecked = await trySendMessage(tabId, { action: 'ping' });
  return !!(rechecked && rechecked.ready);
}

function removeAllContextMenus() {
  if (isPromiseApi) {
    return browserAPI.contextMenus.removeAll();
  }
  return new Promise((resolve) => browserAPI.contextMenus.removeAll(resolve));
}

function setStoredValue(items) {
  if (isPromiseApi) {
    return browserAPI.storage.local.set(items);
  }
  return new Promise((resolve) => browserAPI.storage.local.set(items, resolve));
}

// (Re)create the context menu entries. removeAll keeps this idempotent so it
// is safe to run again whenever an MV3 service worker wakes up.
function registerContextMenus() {
  removeAllContextMenus().then(() => {
    browserAPI.contextMenus.create({
      id: "copy-as-markdown",
      title: "Copy as Markdown",
      contexts: ["selection"]
    });

    browserAPI.contextMenus.create({
      id: "export-as-pdf",
      title: "Export as PDF",
      contexts: ["selection"]
    });
  }).catch((err) => {
    console.error('Could not register the context menus:', err.message);
  });
}

registerContextMenus();

// Listen for menu clicks
browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "copy-as-markdown") {
    copySelectionAsMarkdown(tab);
    return;
  }

  if (info.menuItemId === "export-as-pdf") {
    exportSelectionAsPdf(tab);
  }
});

// Ask the content script to copy the current selection as Markdown. The
// content script never answers this message, so only delivery is checked.
async function copySelectionAsMarkdown(tab) {
  try {
    const target = await resolveTab(tab);
    if (!target || !await ensureContentScript(target.id)) {
      console.warn('Copy as Markdown is not available on this page.');
      return;
    }
    await trySendMessage(target.id, { action: "convertToMarkdown" });
  } catch (err) {
    console.error('Failed to copy selection:', err.message);
  }
}

// Read the current selection, stash it for the print page and open that page
// in a new tab.
async function exportSelectionAsPdf(tab) {
  try {
    const target = await resolveTab(tab);
    if (!target || !await ensureContentScript(target.id)) {
      console.warn('Export as PDF is not available on this page.');
      return;
    }

    const response = await trySendMessage(target.id, { action: "getSelection" });
    if (!response || !response.markdown) {
      console.warn('Nothing selected to export.');
      return;
    }

    const payload = {
      markdown: response.markdown,
      title: response.title || 'Document'
    };

    await setStoredValue({ [PENDING_PDF_KEY]: payload });
    browserAPI.tabs.create({ url: browserAPI.runtime.getURL('pdf.html') });
  } catch (err) {
    console.error('Failed to export selection:', err.message);
  }
}
