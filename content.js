// Cross-browser compatibility.
// Top-level `var` is used on purpose: unlike `const`/`let`, redeclaring these
// bindings is legal, which keeps this file safe to inject a second time into a
// page that already runs an older copy of it.
var browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// A freshly injected copy registers itself as the active instance so it can
// take over from a stale copy that outlived an extension reload.
var copyAsMarkdownInstance = {};
window.__copyAsMarkdownInstance = copyAsMarkdownInstance;

// Third-party libraries loaded before this script via the manifest.
// They expose plain globals on the shared isolated-world window object.
var Turndown = window.TurndownService;
var gfmPlugin = window.turndownPluginGfm;

// Create a Turndown service whose output style matches the extension's
// previous hand-written converter as closely as possible.
var turndownService = new Turndown({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  hr: '---'
});

// GitHub Flavored Markdown support: tables, strikethrough and task lists.
turndownService.use(gfmPlugin.gfm);

// Drop elements that only carry scripting or styling information.
turndownService.remove(['script', 'style', 'noscript']);

// The gfm plugin emits a single tilde, but GitHub (and most renderers)
// require the double-tilde form, so override that rule.
turndownService.addRule('strikethroughWithDoubleTilde', {
  filter: ['del', 's', 'strike'],
  replacement: function (content) {
    return '~~' + content + '~~';
  }
});

// Resolve a possibly relative URL against the document the selection came
// from so the generated Markdown stays usable outside of the page.
function toAbsoluteUrl(url, baseURI) {
  if (!url) return url;
  try {
    return new URL(url, baseURI).href;
  } catch (err) {
    // Leave malformed or non-URL values untouched.
    return url;
  }
}

// Rewrite every link and image target in place before conversion.
function absolutizeUrls(root, baseURI) {
  root.querySelectorAll('a[href]').forEach((element) => {
    element.setAttribute('href', toAbsoluteUrl(element.getAttribute('href'), baseURI));
  });
  root.querySelectorAll('img[src]').forEach((element) => {
    element.setAttribute('src', toAbsoluteUrl(element.getAttribute('src'), baseURI));
  });
}

// Read a code fence language from the various class and data conventions
// used by syntax highlighters in the wild.
function detectLanguage(node) {
  if (!node || !node.getAttribute) return '';

  const classAttr = node.getAttribute('class') || '';
  const patterns = [
    /(?:^|\s)language-([\w+#.-]+)/i,
    /(?:^|\s)lang-([\w+#.-]+)/i,
    /(?:^|\s)highlight-source-([\w+#.-]+)/i,
    /(?:^|\s)brush:\s*([\w+#.-]+)/i,
    /(?:^|\s)([\w+#.-]+)\s+prettyprint/i
  ];

  for (const pattern of patterns) {
    const match = classAttr.match(pattern);
    if (match) return match[1];
  }

  return node.getAttribute('data-language') || node.getAttribute('data-lang') || '';
}

// Reuse Turndown's fence-length logic but read the language hint from a
// wider set of naming conventions than the built-in rule supports.
turndownService.addRule('fencedCodeBlockWithLanguage', {
  filter: function (node, options) {
    return options.codeBlockStyle === 'fenced' &&
      node.nodeName === 'PRE' &&
      node.firstChild &&
      node.firstChild.nodeName === 'CODE';
  },
  replacement: function (content, node, options) {
    const codeNode = node.firstChild;
    const language = detectLanguage(codeNode) || detectLanguage(node);
    const code = codeNode.textContent;
    const fenceChar = options.fence.charAt(0);
    let fenceSize = 3;
    const fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');
    let match;

    // Grow the fence so it never collides with backticks inside the code.
    while ((match = fenceInCodeRegex.exec(code))) {
      if (match[0].length >= fenceSize) {
        fenceSize = match[0].length + 1;
      }
    }

    const fence = fenceChar.repeat(fenceSize);
    return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
  }
});

// Convert an HTML string into Markdown.
function convertToMarkdown(html, baseURI) {
  const container = document.createElement('div');
  container.innerHTML = html;
  absolutizeUrls(container, baseURI || document.baseURI);

  const markdown = turndownService.turndown(container);

  // Clean up extra blank lines
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

// Collect the current selection as both raw HTML and Markdown.
// Returns null when there is nothing selected.
function getSelectionContent() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();
  const container = document.createElement('div');
  container.appendChild(fragment);

  return {
    html: container.innerHTML,
    markdown: convertToMarkdown(container.innerHTML, document.baseURI)
  };
}

// Write plain text to the clipboard, falling back to execCommand when the
// async Clipboard API is unavailable (non-secure context, lost focus).
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();

    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch (err) {
      succeeded = false;
    }

    document.body.removeChild(textarea);
    succeeded ? resolve() : reject(new Error('Copy command failed'));
  });
}

// Listen for messages from background.js.
// The wrapper keeps this injection's instance reference private, so a stale
// copy left behind by an extension reload stops answering as soon as a newer
// copy has been injected into the same page.
(function (instance) {
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ignore every message once a newer instance has taken over.
    if (window.__copyAsMarkdownInstance !== instance) {
      return;
    }

    // Presence check used by background.js before it injects this script.
    if (message.action === 'ping') {
      sendResponse({ ready: true });
      return;
    }

    if (message.action === 'convertToMarkdown') {
      const content = getSelectionContent();

      if (!content) {
        return;
      }

      copyToClipboard(content.markdown).then(() => {
        // Show notification message
        showNotification('Copied as Markdown');
      }).catch(err => {
        console.error('Copy failed:', err);
        showNotification('Copy failed');
      });
      return;
    }

    if (message.action === 'getSelection') {
      const content = getSelectionContent();

      sendResponse({
        markdown: content ? content.markdown : '',
        title: document.title
      });

      // Keep the message channel open for the response.
      return true;
    }
  });
})(copyAsMarkdownInstance);

// Show notification
function showNotification(text) {
  const notification = document.createElement('div');
  notification.textContent = text;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 999999;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.transition = 'opacity 0.3s';
    notification.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 2000);
}
