-- ============================================================================
-- Migration 018: equipment_fuelings.photos
-- ----------------------------------------------------------------------------
-- Adds a jsonb photos column to equipment_fuelings so the public /fueling
-- webform can accept photo uploads (checklist items like "TAKE PICTURES
-- SHOWING EACH SIDE AND ATTACH TO FORM" from the Podio checklists).
-- Photos upload to the existing 'equipment-maintenance-docs' Storage bucket
-- and URLs are stored in this column as [{name, url, uploadedAt, ...}].
-- ============================================================================

ALTER TABLE equipment_fuelings
  ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Allow anon users to write into equipment-maintenance-docs so the public
-- webform can upload. The bucket is already public-read; we're widening
-- write from authenticated-only to include anon submissions. Keeps update /
-- delete restricted to authenticated users.
DROP POLICY IF EXISTS equipment_docs_write ON storage.objects;
CREATE POLICY equipment_docs_write ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'equipment-maintenance-docs');
