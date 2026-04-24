-- Per-equipment ADMIN-ONLY document storage. Separate from equipment.manuals
-- (which surfaces on the public /fueling webform and /equipment detail
-- page). Use this for internal records Ronnie wants attached to a piece
-- but NOT shown to operators during fueling — invoices, registration
-- paperwork, service contracts, warranty docs, PDI reports, photos of
-- pre-purchase inspections, etc.
--
-- Same shape as manuals: [{type:'pdf'|'video', title, url, path?, uploadedAt}].
-- PDFs stored in the equipment-maintenance-docs bucket at
-- documents/<slug>/<timestamp>-<safe-name>.
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;
