# Page Studio Inline Editor

A Manifest V3 Chrome extension that lets you select webpage elements and edit them directly in-place.

## Features

- Toggle direct editing from the extension popup or `Alt+Shift+E`.
- Click any visible element to edit that element directly on the page.
- The editor toolbar appears over the element being edited and follows it while scrolling or resizing.
- Click **Edit Full Page in CKEditor** to capture the active website and open it in a new CKEditor workspace tab.
- From the CKEditor workspace, copy/download the edited HTML or apply it back to the original tab.
- Choose Native Inline, TinyMCE Inline, Tiptap Inline, CKEditor Inline, Aloha Editor, HTML Source, Plain Text, or Whole Page modes.
- Use `Esc` to cancel an inline edit and `Cmd/Ctrl+S` to commit it.
- Edit images directly with resize handles, paste/drop replacement, or `Enter` to upload a local image.
- Apply edits to the current page without changing the original site.
- Autosave drafts per page and element.
- Optional element outlines and HTML sanitization.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this folder: `/Users/Aditya/Documents/TINYMCE_CHROME_PLUGIN`.

## Notes

CKEditor is bundled locally at `vendor/ckeditor/ckeditor.js`, so the full-page CKEditor tab works without a remote CDN. TinyMCE is bundled at `vendor/tinymce/tinymce.min.js`, and Tiptap is bundled at `vendor/tiptap/tiptap.umd.js`. Aloha runs as a true inline editor when its browser bundle is present in `vendor/`. See `vendor/README.md` for expected paths. Chrome extensions should not use remotely hosted editor code for store-ready Manifest V3 packages, so editor assets should be bundled locally.

Edits are local to the current browser tab. Reloading the page restores the original site unless the page itself saves DOM changes.
