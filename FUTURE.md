# Future Work

## R2 / CDN migration for images
**Why:** Git repo currently holds ~451 photos (±35MB). At ~1,000 businesses → 5,000 photos → ±400MB — Git will choke.  
**Approach:** Gitignore `public/images/`, serve photos from Cloudflare R2 bucket.  
**Steps:**
1. Create R2 bucket `barcelona-compare-images`
2. Upload all photos via `wrangler r2`
3. Update Astro config to reference `https://images.barcelonacompare.com` (or R2 public URL)
4. Update `scripts/weekly-refresh.py` to upload new photos to R2 instead of writing to `public/images/`
5. Add R2 credentials to GitHub Actions / Cloudflare Pages env vars
**Priority:** Low — repo is fine at current size. Before next category or city expansion.

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
