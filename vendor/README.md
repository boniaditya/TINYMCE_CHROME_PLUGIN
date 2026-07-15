# Editor Vendor Bundles

Page Studio can attach real inline editors when their browser bundles are present here:

- TinyMCE: `vendor/tinymce/tinymce.min.js`
- Tiptap browser bundle: `vendor/tiptap/tiptap.umd.js`
- CKEditor full package: `vendor/ckeditor/ckeditor.js`
- Aloha Editor: `vendor/aloha/lib/aloha.js`

The extension falls back to its built-in native editor when a selected vendor bundle is not present. CKEditor is bundled at `vendor/ckeditor/ckeditor.js`; CKEditor 4 works best for full HTML documents because it can preserve complete page markup with `allowedContent` and `fullPage` configuration. TinyMCE 8.7.0 is bundled from its npm browser package. Tiptap 3.27.3 is bundled from `@tiptap/core`, `@tiptap/starter-kit`, link, image, and table extensions into a page-context adapter.

Chrome Manifest V3 extensions should not depend on remotely hosted editor code. Keep editor assets bundled locally inside this folder for a reliable unpacked or store-ready build.
