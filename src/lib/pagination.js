// ============================================================================
// wcfSelectAll — paginated SELECT helper
// ============================================================================
// Phase 2.0.0: extracted verbatim from main.jsx.
//
// CRITICAL — DO NOT REWRITE (per MIGRATION_PLAN §10):
// Supabase PostgREST silently caps .limit() at 1000 rows. For any table
// that can realistically grow past that (weigh_ins, cattle_dailys, etc.)
// callers MUST use this helper instead of plain .select(). Caller supplies
// a function that builds a query for a given [from, to] range so ordering
// and filters stay intact across pages.
//
// Usage:
//   const all = await wcfSelectAll((from, to) =>
//     sb.from('weigh_ins').select('*').order('entered_at',{ascending:false}).range(from, to)
//   );
// ============================================================================

export async function wcfSelectAll(buildRangeQuery, pageSize) {
  const page = pageSize || 1000;
  let all = [],
    from = 0;
  while (true) {
    const {data, error} = await buildRangeQuery(from, from + page - 1);
    if (error || !data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}
