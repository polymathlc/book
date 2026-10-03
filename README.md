# Polymath Book Studio

A browser-based A4 worksheet editor for Polymath Learning Centre. Paste questions, place full-resolution pictures, and download aligned worksheets as PDF, PNG, or SVG.

Hosted at **https://polymathlc.github.io/book/**. The relative paths and static GitHub Pages hosting follow the CER app's deployment convention.

## Editing

- Paste text into the question box, or press Ctrl+V / ⌘V over the page to add clipboard text or pictures. Drop or upload several images at once.
- Clipboard text takes priority over an accompanying image preview. While editing a text box, answer, Math Habit or table cell, pasting inserts text at the caret or replaces selected words. Pasting elsewhere creates a new editable text box, with line breaks and supported formatting preserved. Image-only clipboard content still adds an original-resolution picture.
- Add question and answer parts **a, b, c**, or edit each part label independently. An answer has a separate editable value and optional answer line.
- Click a text box, answer or table cell to edit directly where you click. Drag across words to select them; double-click selects a word. Click the border to select the whole box and apply formatting, or drag it to move. Eight side/corner handles resize text boxes without changing font size; boxes grow to keep every line visible. A border drag gives a flowing question free placement. Escape ends typing and selects the box; F2 or Enter resumes editing. **Enter and Shift+Enter** start a new line with the current formatting. Choose fonts, point size, bold, italic, underline, font colour, left/centre/right/justified alignment and **line spacing** in the formatting bar. Select words to format them; select a block to format the whole box.
- **Stacked fractions.** Type or paste a fraction such as `2/5` and it is shown with the numerator above a bar above the denominator, in text boxes, answers, tables and Math Habit banners, on screen, in print, and in PDF/PNG/SVG. The stored text stays plain `2/5`, so editing, copying and AI answers are unaffected. Dates (3/4/2024), decimals (1/2.5) and units (km/h) are left alone. Untick **Stack fractions** above the preview to show plain slashes; the choice is saved with the book.
- **Arrange pages** opens a thumbnail view of the whole book. Each card is a live preview of the page, in order. Drag cards to reorder (a teal bar shows the drop spot), use ◀ ▶ or Alt+←/→ on a focused card, duplicate or delete a page, click to select and double-click or Enter to open it.
- **Reorder pages** by dragging a page number in the left panel, with the **◀ Earlier / Later ▶** buttons, or with Alt+Shift+←/→. Elements travel with their page and the printed page numbers follow the new order.
- **Copy, cut and paste elements like PowerPoint.** Select one or several elements and press Ctrl/⌘+C (or X), open any page, then press Ctrl/⌘+V or **Paste here**. Pasted elements appear at exactly the same position on the destination page, keeping their relative spacing and every detail: font, size, colour, bold/italic/underline, alignment, line spacing, table cells, shape styling and original image bytes. Elements in text flow are pasted as freely placed elements at the spot where they were shown. Pasting back onto the same page offsets the copy slightly so the original stays visible; a cut-and-paste keeps the exact position. Copy/Cut/Paste are also in the right-click menu and inspector. Paste can be undone.
- **Ctrl/⌘+Shift+C** copies formatting (font, size, colour, bold, italic, underline, alignment, line spacing, heading style; shape fill/outline/radius; table lines, padding, row height, header style and cell text style); **Ctrl/⌘+Shift+V** pastes it onto selected text or elements. Ctrl/⌘+B, I and U work while typing. The inspector's plain-text edits also preserve existing formatting.
- Roboto is included locally with normal, bold and italic faces. Century Gothic, Helvetica, Calibri and the other system fonts use the installed font where available, with a fallback otherwise. Roboto is also embedded in SVG/PDF rendering. See `assets/fonts/LICENSE` (SIL Open Font License; Fontsource Roboto 5.3.0).
- Insert rectangles, rounded rectangles, circles, ellipses and lines. Change fill, outline colour/thickness and corner radius, drag or resize them, and use the same alignment tools as images. Circles stay circular.
- Insert tables with up to 50 rows and 12 columns. Click cells, use Tab between cells, and change rows, columns, border colour/thickness, padding and header style. Existing cells survive table resizing. Long rows, answers and text continue onto additional A4 sheets.
- **Keyboard shortcuts** lets you assign insert commands to your own key combinations. Settings travel with the book and persist in the device/cloud draft. Editing and browser shortcuts are protected from accidental replacement.
- Images start in free placement. Drag anywhere within the worksheet's content area; drag a corner to resize while preserving aspect ratio. Moving and resizing never re-encodes the original image.
- Enable **Free placement** for text, Math Habit banners, or other elements to position them independently. Use the Elements list to reorder items in normal text flow.
- Shift-click to select several elements. Align edges or centres, distribute spacing, or move them together. Use Snap for grid and alignment guides; hold Alt during a drag to bypass snapping.
- Use arrow keys to nudge, Shift+arrow for larger movements, Ctrl+D / ⌘D to duplicate, Delete to remove, and Ctrl+Z / ⌘Z to undo. Lock elements to protect their position.
- Add any number of small **Math Habit** banners. Each has its own number, title, order, and optional position. Double-click the title or number to edit it on the page, with font, colour, line breaks, formatting and undo support.
- Right-click an image and select **CER touch-up** for the original CER manual image editor. Erase, paint, fill, clone, history brush, selection, lasso, wand, move, resize, rotate, skew, straighten, line, text, crop selection, and clean-paper tools are available.
- Restore the original image after editing. Undo/redo also applies to image changes.
- Add pages, duplicate or delete pages, and move elements between pages with the inspector. Text flow continues onto additional A4 sheets when needed.
- Right-click an element and choose **Repeat on future pages…**. Set exact X/Y coordinates in millimetres from the top-left of the A4 page, within its content area. Repetition begins on the source page and includes later pages and continuation sheets. **Same content on every page** shares one editable source. **Same position, independent content** creates blank text/answer boxes, table cells and question-image placeholders that you can fill separately; shapes keep their appearance. Paste an original image into a selected image placeholder, or use **Replace image**.
- Choose **Make this copy independent** to detach just that printed-page copy, keeping its position and content. Other copies stay shared. **Use repeated version** restores a shared copy; **Reset from layout** clears an independent layout copy. Deleting an independent copy suppresses it on that sheet. All changes support undo and survive device/cloud autosave and saved projects. **Keep flowing questions clear** reserves space around repeated elements; turn it off for overlays. Stopping repetition preserves independently edited copies.

## Drawing, hold-to-snap shapes and the pen select

- **✏ Draw** (in the Insert row) turns on freehand drawing straight onto the worksheet page. Choose a colour and a thickness in the small bar that appears, then draw with a mouse, pen or finger. **Hold still for about half a second** (a few pixels of jitter are allowed) and the stroke snaps to the shape you meant: a straight line, an arc or smooth curve, a circle, an ellipse, a rectangle or square, a triangle, or a regular pentagon/hexagon. Keep dragging after the snap to adjust it (the radius, corner or end follows the pen) and lift to keep it. A scribble that is not a shape is left as ink. Esc cancels the stroke; **Done** (or the Draw button again) turns drawing off. A tap or an accidental dot is ignored.
- Each drawing is one ordinary floating element: a snapped circle, ellipse, level line or upright rectangle becomes a native **shape** block (so fill, outline and corner radius work as usual); everything else becomes a **Drawing** shape (`kind: "path"`) that moves, resizes, aligns, copies, repeats and exports with the page. One drawing is one undo step, and drawings appear identically in print, PDF, PNG and SVG. Drawings on a continuation sheet belong to that sheet.
- **CER touch-up** has the same hold-to-snap for the 🖌 Paint and ➰ Lasso tools (Erase, Clone and History deliberately never snap), and a **🖊 Pen select** tool (shortcut **P**) like Photoshop's pen: click to place a corner anchor, click-and-drag for a smooth anchor with symmetric curve handles, then click the first anchor (or press Enter, or double-click) to close the path into a selection. Drag an anchor or a handle to adjust it (Alt breaks one handle, Shift locks 45°), Backspace removes the last anchor, Esc drops the path. The selection works with fill, delete, move, resize, rotate and AI fill like any other.
- `shape-snap.js` is a dependency-free module shared byte-for-byte with the Ans Key and CER repositories. If it fails to load, drawing and painting simply stay plain ink.

## Output and storage

**Download PDF** produces all preview pages in one A4 PDF at 300 dpi using lossless compression. **Print / PDF** uses native browser printing and preserves selectable text. Set paper to A4, scale to 100%, margins to none, and turn browser headers/footers off. PNG exports are 2480 × 3508 px; SVG embeds the full source images and positioned text. Multiple PNG/SVG pages download separately.

**Save project** downloads a portable `.book.json` file with full image sources and layout. **Open project** restores it. The working draft is autosaved in this browser's IndexedDB. Editing and file downloads work without an account. When signed in, full projects and original images also autosave to the shared Polymath Firebase project. AI generation sends the current page's text and a reading copy of its images to the configured AI service.

Limits are explicit: each uploaded image can be up to 30 MB; manual touch-up supports images up to 24 million pixels and 16384 pixels per side. Images above the editor limit can still be placed and exported at original quality. Touch-up never silently downsamples an image to open it; very large images are refused while the worksheet retains the original. The transform tool limits extremely large output canvases to keep browser memory manageable. CER's question database and image regeneration are not included; the answer tools use its existing server AI connection.

The printable layout has a slim masthead, generous A4 margins, compact teal banners, and the original sticker logo immediately left of the Polymath footer name. No repeated PSLE Math Tips heading or framed logo.

## AI answers and workings

Open **AI answers & workings**, or right-click a question, image, answer or table. Sign in with the same Polymath account used by CER, Ans Key or Tutor. Choose all questions on the current manual page or a specific question/part. The panel reads every text block, table, picture, banner and existing teacher answer, plus rendered images of all continuation sheets. Its context is shown before generation.

Tools generate answers and arithmetic workings, explain a method, check question/answer consistency, or suggest Math Habits. They follow the arithmetic and unitary-method rules from Ans Key/Tutor and read available shared teaching notes and answer-style corrections. Missing/unreadable information is returned as a clarification. Generated part labels, answers, workings and explanations are editable before adding to the current page or a separate answer-key page. Changing a source question invalidates its result; cancelled/stale requests never insert content.

The shared `askOpenAi` callable leads, with `askKimi` and Firebase AI Logic as backups. Provider secrets stay on the existing server. The public Firebase web configuration and App Check site key match the sibling apps. Live AI needs the existing services, an authorised account and an allowed hosting domain; access/load errors are shown in the panel.

## Firebase cloud autosave

**Cloud books** signs in, lists saved books, opens them on another device, saves immediately, or saves a separate copy. After sign-in, changes autosave after 2.5 seconds of inactivity. A device draft continues to save after 0.5 seconds. Offline changes retry when the connection returns, and errors remain visible without discarding local work.

This uses Ans Key's Firebase project `mathgen--app` and bucket `mathgen--app.firebasestorage.app`, with the existing Google/email account and App Check setup. No separate backend is introduced. A namespaced `bookStudioProjects` index is merged into `adminSettings/{uid}`; all other settings are preserved. Gzipped full projects are uploaded under `pdf-annotator/book-{uid}-{bookId}-{revision}.book.json.gz`, alongside Ans Key's existing large-annotation storage path. Book Studio does not write the `pdfAnnotator` worksheet collection.

Each upload preserves original image data and includes a SHA-256 content stamp. A Firestore transaction checks the previous revision before advancing the index. If another device saved first, autosave pauses and offers the cloud version or **Save as a new cloud book**. It never silently overwrites the newer version. Cloud access is governed by the existing Firebase rules; the signed-in account must be allowed to update its `adminSettings` document and read/write the shared Storage path. The app reports denied access rather than claiming a successful save. No Firebase rules are weakened or replaced by this repository.

## Development

No build step or runtime dependencies. Node 22+ runs validation:

```sh
npm run check
npm test
npm run serve
```

Open http://127.0.0.1:4173. `tests/core.test.js` verifies project/image preservation, multiple banners, alignment, SVG/import safety, line wrapping, the diagram's 24-dot answer, and A4 PDF structure. `npm install --no-save playwright@1.62.1`, `npx playwright install chromium`, and `npm run test:browser` run the browser acceptance suite. These checks cover paste, drag/resize, touch-up apply/undo, overflow pages, export alignment, draft/project persistence, selected-word formatting, Enter/Shift+Enter, line spacing, shapes, table cells, custom shortcuts, AI page context, cloud save/load, revision conflicts and offline recovery. The additional text-box and page-template acceptance checks cover precise single-click caret placement, native word/drag selection, box switching, frame resizing, banner editing, exact repeat positions, per-sheet independent copies, blank question/image layouts, original image replacement, reserved flow space and copy identities after reload. AI and cloud acceptance tests use Firebase service doubles, not live accounts or billable provider calls. Live account permissions/provider availability must be checked in the signed-in app.

## Deployment

`.github/workflows/check.yml` validates pull requests and main. `.github/workflows/pages.yml` validates and deploys the static site after merge. In repository Settings → Pages, the source must be **GitHub Actions** before the first publish. The workflow intentionally publishes application modules, the original brand asset and licensed font files.

See [CER_TOUCHUP.md](CER_TOUCHUP.md) for the source and adaptation of the manual touch-up tools.
