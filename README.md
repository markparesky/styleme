# StyleMe 2.0 — working prototype

A closet-first personal stylist. No build step, no framework, no server logic —
plain HTML/CSS/JS modules. All data stays on the device in IndexedDB.

## What's implemented

- **Add** — drop photos (single or batch). Colors are read on-device, warm/cool
  lighting casts are auto-corrected against a white background ("sheet of paper"
  trick), backgrounds are cut out, and every color is confirmed **by name**
  (Ivory vs. White vs. Cream) with tap-to-fix alternatives. Add-by-image-URL too.
- **My Closet** — shelves by category, search, dressiness filters, edit/delete,
  laundry state. Items without photos render as color-true silhouettes, never
  gray circles.
- **Stylist** — describe the occasion (free text is parsed) or tap a chip.
  Generates three outfits scored by color harmony + formality, rendered as
  flat-lays from your own cut-outs, each with a color story and a plain-language
  "why this works." Per-slot swap (⇄) and shuffle. Avoids combos worn in the
  last 14 days.
- **Mirror check** — "Wear it" logs the wear, takes an optional mirror photo,
  a 1–5 heart rating, and per-item "into the wash" toggles.
- **Lookbook** — every worn look with photo (or mini flat-lay), date, occasion,
  rating.
- **Barcode scan** — scan a purchased item's tag with the camera (or a photo
  of it). Uses the browser's built-in BarcodeDetector where it truly works,
  and automatically falls back to a WebAssembly decoder (zbar, loaded from
  CDN on first use) everywhere else — Windows desktop and iPhone included. Public
  product databases are tried for a name/photo; apparel coverage is spotty, so
  the barcode always attaches to the item as its identifier and one photo of
  the garment supplies true color.
- **Pack** — destination + dates + occasion mix + itinerary (golf, tennis,
  workouts, beach, hiking counts and free-text theme nights — "white party"
  finds your white clothes or flags that you own none) + bag type (carry-on
  ~12 garments vs. checked ~22) + laundry access (washes mid-trip shrink what
  you pack). Real weather (Open-Meteo, no key), a capsule optimized for
  re-combination, gap warnings before you fly ("no workout gear", "won't fit
  the bag", "run laundry before packing"), day-by-day plan, and a checklist
  that counts underwear by days-between-washes.
- **Home** — morning card: set your city once, get tomorrow's weather-matched
  outfit. First run offers a 14-item demo closet.

- **Sync across devices** — make up a closet code on the Home page; enter the
  same code on any device and your closet appears there. Changes auto-sync.
  Only a SHA-256 hash of the code leaves the device.

## One-time setup for sync (Cloudflare dashboard)

Sync needs a KV namespace bound to the Pages project (2 minutes, one time):

1. Dashboard → **Storage & databases → KV** → Create namespace, name it
   `styleme-sync`.
2. Your Pages project (**styleme**) → **Settings → Bindings** → Add →
   **KV namespace** → variable name `STYLEME_KV` → select `styleme-sync` →
   Save.
3. Redeploy (Deployments → ⋯ → Retry, or just wait for the next git push).

Until then the app works normally; the sync card just reports that the
server isn't set up yet.

## Run locally

Serve this folder over HTTP (ES modules don't run from file://). Any static
server works. From Claude Code, start the `styleme-app` config in
`.claude/launch.json` (port 8744).

## Deploy

The folder is deployable as-is to any static host — Cloudflare Pages
(drag-and-drop the folder at dash.cloudflare.com → Pages), Netlify, GitHub
Pages. No environment variables, no build command, output dir = this folder.

## Not yet built (from the vision doc)

Retailer link scraping with colorway picker (needs a server-side proxy),
photo recognition in mirror check, taste-model learning from ratings,
splurge/steal shopping engine.
