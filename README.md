# Copy as Markdown

Right-click any selection to copy it as clean Markdown, or export it as a PDF.

**Copy as Markdown** is a lightweight browser extension for Chrome and Firefox.
Turn anything you can select on a page into GitHub Flavored Markdown straight
from the context menu — no viewer, no converter website, no cleanup afterwards.

## Features

- **Copy as Markdown** — right-click a selection and the Markdown is on your
  clipboard.
- **Export as PDF** — the same selection opens as a clean, print-ready A4
  document, ready to save as a searchable PDF from the print dialog.
- **Code blocks keep their language.** Fences are read from `language-`,
  `lang-`, `highlight-source-` and `brush:` class names, plus `data-language`
  and `data-lang` attributes. If the code contains backticks, the fence grows
  automatically so the block is never broken.
- **GitHub Flavored Markdown** — tables become pipe tables, task lists become
  `- [x]` items, and strikethrough uses the double-tilde form.
- **Links and images stay useful.** Relative URLs are resolved against the page
  you copied from, so they still work after pasting.
- **Works everywhere.** The content script is injected on demand, so the
  extension also works in tabs that were already open when it was loaded.

## Installation (development)

The extension ships two manifests, one per browser. Copy the right one to
`manifest.json` before loading the extension unpacked.

### Chrome (Manifest V3)

```bash
cp manifest.json.chrome manifest.json
```

Then open `chrome://extensions`, enable **Developer mode**, click
**Load unpacked** and select the project directory.

### Firefox (Manifest V2)

```bash
cp manifest.json.firefox manifest.json
```

Then open `about:debugging#/runtime/this-firefox`, click
**Load Temporary Add-on…** and pick the `manifest.json` file.

## Usage

1. Select some text on a page.
2. Right-click the selection.
3. Choose one of:
   - **Copy as Markdown** — converts the selection and writes it to the
     clipboard. A short toast confirms the result.
   - **Export as PDF** — opens the selection in a new tab, rendered in a clean
     A4 layout, and opens the print dialog. Pick **Save as PDF** as the
     destination.

## Building

`build.sh` packages both targets into `dist/`:

```bash
./build.sh            # build both targets
./build.sh chrome     # build the Chrome zip only
./build.sh firefox    # build the Firefox xpi only
./build.sh clean      # remove the dist directory
./build.sh help       # show usage
```

Output:

```text
dist/copy-as-markdown-chrome-v<version>.zip    # Manifest V3
dist/copy-as-markdown-firefox-v<version>.xpi   # Manifest V2 (unsigned)
```

Load the `.xpi` through `about:debugging` for testing, or submit it to
addons.mozilla.org to get a signed copy for release.

## Project structure

```text
background.js           Service worker / background page: registers the context
                        menus, injects the content script on demand, and hands
                        the selection over to the print page.
content.js              Content script: selection -> Markdown conversion,
                        clipboard writing and the on-page toast.
pdf.html / pdf.js      Standalone print page that renders the Markdown and
                        opens the browser print dialog.
manifest.json.chrome    Manifest V3 definition (Chrome).
manifest.json.firefox   Manifest V2 definition (Firefox).
build.sh                Packaging script for both stores.
vendor/                 Third-party libraries:
                          turndown.js            HTML -> Markdown
                          turndown-plugin-gfm.js GFM tables / task lists
                          marked.js              Markdown -> HTML (print page)
48.png / 128.png        Extension icons.
```

## How it works

1. `background.js` creates two context-menu entries for text selections.
2. On click it makes sure `content.js` is present (injecting it if needed) and
   sends a message.
3. For **Copy as Markdown**, the content script reads the current selection,
   converts it with Turndown and writes the result to the clipboard.
4. For **Export as PDF**, the content script returns the Markdown to the
   background, which stashes it in `storage.local` (single-use) and opens
   `pdf.html`. That page renders the Markdown with marked, waits for images and
   fonts, then opens the print dialog.

## Privacy

The extension makes no network requests and collects no data. The only stored
value is a temporary, single-use hand-off to the print page; it is deleted as
soon as it has been read.

## License

Bundles the following MIT-licensed libraries:

- [Turndown](https://github.com/mixmark-io/turndown)
- [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm)
- [marked](https://github.com/markedjs/marked)
