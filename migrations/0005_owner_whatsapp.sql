-- 0005_owner_whatsapp.sql
-- The WhatsApp number an owner publishes on their listing (B2B Phase 1).
--
-- Only 9 of the 1,182 listings carry a WhatsApp number from Google, but this
-- market books on WhatsApp — so the owner dashboard has to be the way the other
-- 1,173 get one. The value is stored normalised to wa.me digits (`34640793674`)
-- so the edge injector builds the link without re-guessing the format.
--
-- Semantics (matching `services` / `hours` in 0003):
--   whatsapp IS NULL  -> owner never set one; the Google-derived CTA stays
--   whatsapp = digits -> owner's number wins over the frontmatter value
--
-- Type: TEXT, not INTEGER — phone numbers lose their leading zeros as integers.
--
-- Docs: docs/whatsapp-cta.md

ALTER TABLE profile_overrides ADD COLUMN whatsapp TEXT;
