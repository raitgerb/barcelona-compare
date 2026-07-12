# Future Work

## ~~R2 / CDN migration for images~~ ✅ DONE (July 2026)
Photos migrated to R2 bucket `barcelona-compare-images`, served via public R2.dev URL, removed from git tracking.

## Custom domain for R2 images
**Why:** Current URL (`pub-37760591f0394eafb9519ca1c4db5865.r2.dev`) is a Cloudflare hash. A custom subdomain (`images.barcelonacompare.com`) looks professional and shares domain authority.  
**Steps:**
1. In Cloudflare dashboard → R2 → `barcelona-compare-images` → Settings → Custom Domains
2. Add `images.barcelonacompare.com` (Cloudflare will auto-configure DNS since the zone is already managed)
3. Update `R2_IMAGE_BASE_URL` env var in Cloudflare Pages to `https://images.barcelonacompare.com`
4. Redeploy
**Priority:** Low — cosmetic only. The `pub-` URL works fine.

## Smart photo selection
**Why:** Google returns 10 photos per business, we pick the first 5 blindly. Some are blurry, dark, logos, or menus.  
**Approach:** Build-time heuristic (no AI, no service) to score and pick the best 5.  
**Scoring signals:**
- File size (bigger → less compression, more detail)
- Brightness (reject near-black photos)
- Aspect ratio (reject extreme panoramas — usually menus or logos)
- Resolution (reject tiny thumbnails)
**When to upgrade to a service:** 10,000+ images, on-the-fly transforms needed, or user-uploaded content requiring moderation.
**Priority:** Low — current photos are good enough. Adds polish.

## Complete remaining data collection
**Why:** `scripts/broaden.py` found 2,107 candidates but only processed 1,232 (killed at user request). ~875 remain uncollected — mostly businesses in outer barrios (Sant Andreu, Nou Barris, Horta-Guinardó) and marginal keyword variants.

**What's needed:**
1. Modify `scripts/broaden.py` to **resume** rather than restart — skip already-collected place IDs
2. Or: write a standalone script that reads the skipped candidates from a saved JSON file (the broaden script doesn't currently save a candidate list — it discovers + enriches in one pass)
3. **Better approach for next time:** Split into two phases:
   - **Phase 1 (discovery):** Run all three strategies, save candidate place IDs + names to `data/candidates.json` — fast, no enrichment
   - **Phase 2 (enrichment):** Read `data/candidates.json`, filter out already-collected, enrich remaining in batches (e.g., 100 at a time with `--batch` flag)

**To run a second pass now:**
```bash
# The script deduplicates against existing content files, so re-running
# will skip what we already have. But it will re-run all 550+ discovery
# queries. Add --skip-discovery to jump straight to enrichment from a
# saved candidate list (need to implement this first).
python scripts/broaden.py
```

**Estimated remaining:** 200-400 legitimate nail/massage businesses in the unprocessed ~875 candidates (rest are false positives from loose grid search types).

**Priority:** Medium — current 848 businesses is already solid coverage. This is marginal gain.
**Status:** Deferred (July 2026) — not worth the $25–50 in Google API costs right now. Revisit when the site has more traffic and marginal coverage matters more. This is a "later," not a "never."
