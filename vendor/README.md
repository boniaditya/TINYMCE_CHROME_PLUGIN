# Editor Vendor Bundles

Page Studio can attach real inline editors when their browser bundles are present here:

- TinyMCE: `vendor/tinymce/tinymce.min.js`
- Tiptap browser bundle: `vendor/tiptap/tiptap.umd.js`
- Milkdown Crepe browser bundle: `vendor/milkdown/milkdown.js`
- CKEditor 5 browser bundle: `vendor/ckeditor5/ckeditor5.umd.js`
- DocShift browser bundle: `vendor/docshift/docshift.min.js`
- JSDoc legacy Word reader/writer: `vendor/jsdoc-word/docToText.js` and `textToDoc.js`
- Aloha Editor: `vendor/aloha/lib/aloha.js`

The extension falls back to its built-in native editor when a selected vendor bundle is not present. CKEditor 5 version 49.0.1 is bundled from its official npm browser package with its open-source GPL license declaration. TinyMCE 8.7.0 is bundled from its npm browser package. Tiptap 3.27.3 is bundled from `@tiptap/core`, `@tiptap/starter-kit`, link, image, and table extensions into a page-context adapter. Milkdown Crepe 7.21.3 is bundled into a page-context adapter with its CSS and KaTeX font assets under `vendor/milkdown/`.

The offline Word workspace bundles DocShift 0.0.73 under the MIT license for `.docx` conversion and JSDoc under the 0BSD license for clean-room Word 97–2003 `.doc` parsing and writing. Their license files are stored alongside each bundle.

Chrome Manifest V3 extensions should not depend on remotely hosted editor code. Keep editor assets bundled locally inside this folder for a reliable unpacked or store-ready build.
