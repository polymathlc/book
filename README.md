# Polymath Book Studio

A browser-based A4 worksheet editor for Polymath Learning Centre. Paste questions, place full-resolution pictures, and download aligned worksheets as PDF, PNG, or SVG.

Hosted at **https://polymathlc.github.io/book/** once GitHub Pages is enabled for this repository. The relative paths and static GitHub Pages hosting follow the CER app's deployment convention.

## Editing

- Paste text into the question box, or press Ctrl+V / ⌘V over the page to add clipboard text or pictures. Drop or upload several images at once.
- Images start in free placement. Drag anywhere within the worksheet's content area; drag a corner to resize while preserving aspect ratio. Moving and resizing never re-encodes the original image.
- Enable **Free placement** for text, Math Habit banners, or other elements to position them independently. Use the Elements list to reorder items in normal text flow.
- Shift-click to select several elements. Align edges or centres, distribute spacing, or move them together. Use Snap for grid and alignment guides; hold Alt during a drag to bypass snapping.
- Use arrow keys to nudge, Shift+arrow for larger movements, Ctrl+D / ⌘D to duplicate, Delete to remove, and Ctrl+Z / ⌘Z to undo. Lock elements to protect their position.
- Add any number of small **Math Habit** banners. Each has its own number, title, order, and optional position.
- Right-click an image and select **CER touch-up** for the original CER manual image editor. Erase, paint, fill, clone, history brush, selection, lasso, wand, move, resize, rotate, skew, straighten, line, text, crop selection, and clean-paper tools are available.
- Restore the original image after editing. Undo/redo also applies to image changes.
- Add pages, duplicate or delete pages, and move elements between pages with the inspector. Text flow continues onto additional A4 sheets when needed.

## Output and storage

**Download PDF** produces all preview pages in one A4 PDF at 300 dpi using lossless compression. **Print / PDF** uses native browser printing and preserves selectable text. Set paper to A4, scale to 100%, margins to none, and turn browser headers/footers off. PNG exports are 2480 × 3508 px; SVG embeds the full source images and positioned text. Multiple PNG/SVG pages download separately.

**Save project** downloads a portable `.book.json` file with full image sources and layout. **Open project** restores it. The working draft is autosaved in this browser's IndexedDB. No account, server, or image upload is needed. Private worksheet content remains on the device unless the user chooses to share an exported file.

Limits are explicit: each uploaded image can be up to 30 MB; manual touch-up supports images up to 24 million pixels and 16384 pixels per side. Images above the editor limit can still be placed and exported at original quality. Touch-up never silently downsamples an image to open it; very large images are refused while the worksheet retains the original. The transform tool limits extremely large output canvases to keep browser memory manageable. AI regeneration and CER's authenticated question database services are not included in this standalone editor.

The printable layout has a slim masthead, generous A4 margins, compact teal banners, and the original sticker logo immediately left of the Polymath footer name. No repeated PSLE Math Tips heading or framed logo.

## Development

No build step or runtime dependencies. Node 22+ runs validation:

```sh
npm run check
npm test
npm run serve
```

Open http://127.0.0.1:4173. `tests/core.test.js` verifies project/image preservation, multiple banners, alignment, SVG/import safety, line wrapping, the diagram's 24-dot answer, and A4 PDF structure. `npm install --no-save playwright@1.62.1`, `npx playwright install chromium`, and `npm run test:browser` run the browser acceptance suite. These checks cover paste, drag/resize at different zoom levels, touch-up apply/undo, overflow pages, export alignment, and draft/project persistence.

## Deployment

`.github/workflows/check.yml` validates pull requests and main. `.github/workflows/pages.yml` validates and deploys the static site after merge. In repository Settings → Pages, the source must be **GitHub Actions** before the first publish. The workflow intentionally publishes only application files and the original brand asset.

See [CER_TOUCHUP.md](CER_TOUCHUP.md) for the source and adaptation of the manual touch-up tools.
