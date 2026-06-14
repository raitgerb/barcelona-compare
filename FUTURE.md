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
