-- Podio checklist apps for equipment that takes attachments (e.g. Ventrac's
-- Tough Cut / AERO-Vator / Landscape Rake) carry additional category fields
-- with labels like "Tough Cut -- Every 50 Hours". Those tasks belong to the
-- attachment, not the base machine. Store them separately so the webform can
-- surface them as optional sub-checklists without colliding with main intervals.
--
-- Shape: [{name:'Tough Cut', hours_or_km:50, kind:'hours', label:'Tough Cut — Every 50 Hours', tasks:[{id,label}], help_text:null}]
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS attachment_checklists JSONB NOT NULL DEFAULT '[]'::jsonb;
