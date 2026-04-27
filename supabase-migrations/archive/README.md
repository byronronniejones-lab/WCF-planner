## Archive

Migrations 001 through 026 — already applied to production Supabase (project `pzfujbjtayhkdlxiblwe`). Moved here on 2026-04-27 to keep the top-level `supabase-migrations/` folder showing only new/upcoming migrations awaiting application.

Files are unchanged in content. References to migration numbers in `PROJECT.md` (`§3 Database schema`, `§7 Don't-touch list`) and inline source comments (e.g. `cattleProcessingBatch.js`'s "column only exists post-migration-015") still resolve conceptually — find the file by number under `archive/`.

When adding a new migration, place it directly in `supabase-migrations/` (parent folder), not here. After it's applied to production, it can optionally be moved into this archive in a later cleanup commit.
