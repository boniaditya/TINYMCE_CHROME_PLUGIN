# Notepad Library

A Manifest V3 Chrome extension for keeping a threaded library of local notes, online notepads, and directly opened notepad links.

## Features

- Open and organize notepad.pw and notepad.cc pages from the extension.
- Create local notepads with TinyMCE, Tiptap, Milkdown WYSIWYG Markdown, Markdown source/preview, or plain text editors.
- Autofill or append editor-specific randomized Lorem Ipsum sample text to the open local note.
- Export the open local note as Markdown, HTML, plain text, or JSON.
- Group notes into threaded folders from the sidebar.
- Review directly opened notepad.pw and notepad.cc links in a bottom-docked History folder.
- Open historical links from the sidebar into the current page, with a separate new-tab control.
- Keep recent notes available from the popup and supported online notepad pages.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this folder: `/Users/Aditya/Documents/TINYMCE_CHROME_PLUGIN`.

## Notes

TinyMCE is bundled at `vendor/tinymce/tinymce.min.js`, Tiptap is bundled at `vendor/tiptap/tiptap.umd.js`, and Milkdown Crepe is bundled at `vendor/milkdown/milkdown.js`. See `vendor/README.md` for expected paths. Chrome extensions should not use remotely hosted editor code for store-ready Manifest V3 packages, so editor assets should be bundled locally.

Local notes are stored in Chrome extension storage. Online notepads open on their source websites.

Bugfixes and small updates should stay on the current `7.x` line, such as `7.0.1` or `7.1.0`. Only major feature releases should move to the next major `.0.0` version.
