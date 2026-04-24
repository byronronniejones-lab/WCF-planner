-- Per-equipment reference materials. Ronnie wants operator manuals (PDFs)
-- and YouTube videos mapped to each piece so the public /fueling webform
-- and the /equipment/<slug> detail page can surface them as an expandable
-- card above the checklist.
--
-- Shape: [
--   {type:'pdf',   title:'NH Powerstar 100 Operator\'s Manual', url:'https://.../file.pdf', path:'manuals/ps100/...', uploadedAt:'2026-04-24T...'},
--   {type:'video', title:'Grease zerk locations',              url:'https://youtu.be/abc123'},
--   ...
-- ]
-- PDFs carry `path` so the admin remove-button can also delete the bucket
-- object. Videos are YouTube URLs only — we derive the thumbnail from the
-- video id at render time.
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS manuals JSONB NOT NULL DEFAULT '[]'::jsonb;
