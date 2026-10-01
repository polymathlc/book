# CER touch-up integration

`cer-touchup.js` reuses the manual annotation editor and clean-paper pixel functions from `polymathlc/cer`'s `app.js`. Its toolbar markup was adapted from CER's `index.html`. The existing Polymath sticker is copied unchanged from `assets/branding/polymath-learning-centre.png`.

The editor is integrated through `window.BookTouchup.open(imageDataUrl, callback)`. Apply returns a PNG at the current canvas resolution and updates the selected Book Studio image as one undoable change. Cancel leaves the worksheet image unchanged. The worksheet keeps the untouched input separately for Restore original and project export.

Adaptations:

- Removed question-database, authentication, card-art, upload, and AI service dependencies. The manual tools use the same original algorithms and keyboard controls.
- Open images at native resolution rather than CER's original question-image display cap. Large native images are rejected explicitly, without downsizing the stored worksheet image.
- Clipboard layers retain native pixels; their display size is handled by the original transform tools.
- Limit full-frame undo snapshots according to pixel count to avoid retaining ten large photographs in memory.
- Add Crop selection using the original selection's bounding rectangle and raw pixel copying.
- Use Book Studio's toast and apply callback, and style the modal to match the editor.

CER's AI regeneration needs its authenticated services and is intentionally not represented as an available local tool.
