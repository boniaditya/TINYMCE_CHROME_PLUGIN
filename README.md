# Notepad Library

A Manifest V3 Chrome extension for keeping a threaded library of local notes, online notepads, and directly opened notepad links.

## Features

- Open and organize notepad.pw and notepad.cc pages from the extension.
- Create local notepads with CKEditor, TinyMCE, Tiptap, Milkdown WYSIWYG Markdown, Markdown source/preview, or plain text editors.
- Open, edit, autosave, and export `.doc` and `.docx` Word documents entirely offline.
- Format Word documents with fonts, sizes, colors, alignment, indentation, advanced lists, tables, images, page breaks, special characters, find/replace, print, and adjustable zoom.
- Select inserted or imported images to resize them by dragging, apply preset sizes, crop locally, edit alt text, or remove them.
- Save the entire library—including notes, Word content, embedded images, folders, history, and preferences—to one checksummed JSON backup, then restore it after reinstalling the extension.
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

CKEditor 5 is bundled at `vendor/ckeditor5/ckeditor5.umd.js`, TinyMCE is bundled at `vendor/tinymce/tinymce.min.js`, Tiptap is bundled at `vendor/tiptap/tiptap.umd.js`, and Milkdown Crepe is bundled at `vendor/milkdown/milkdown.js`. See `vendor/README.md` for expected paths. Chrome extensions should not use remotely hosted editor code for store-ready Manifest V3 packages, so editor assets are bundled locally.

Offline Word conversion uses DocShift for `.docx` files and the clean-room JSDoc reader/writer for legacy `.doc` files. Imported documents are converted to editable semantic HTML, so complex pagination, macros, tracked changes, and advanced Word layout may be simplified.

The Word workspace uses an original native `contenteditable` implementation and custom formatting toolbar; it does not use CKEditor. CKEditor remains available only as a separate general-purpose note type.

Local notes are stored in Chrome extension storage. Online notepads open on their source websites.

Every completed extension update increments directly to the next major `x.0` version. Do not use patch or minor version increments; for example, `9.0` must be followed by `10.0`.
