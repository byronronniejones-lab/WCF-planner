import React from 'react';
import {RECURRENCE_OPTIONS} from '../lib/tasks.js';
import {
  loadTaskTemplates,
  loadOpenTaskInstances,
  loadCronAuditTail,
  upsertTaskTemplate,
  deleteTaskTemplate,
  runCronNow,
} from '../lib/tasksAdminApi.js';

// Admin Tasks Center — C1.
// Sections (admin-only; see UnauthorizedRedirect wrapper at the route mount):
//   1. Template CRUD list + create/edit modal
//   2. Open task_instances read-only list
//   3. Last-5 cron audit footer
//   4. "Run Cron Now" button
//   5. "Manage Team Roster" CTA → existing WebformsAdminView
//
// `requires_photo` is intentionally absent from every form here — it was
// dropped from task_templates + task_instances by mig 039.

const PAGE_BG = {
  minHeight: '100vh',
  background: '#f9fafb',
  fontFamily: 'inherit',
};
const CARD = {
  background: 'white',
  borderRadius: 10,
  padding: '16px 18px',
  marginBottom: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  border: '1px solid #e5e7eb',
};
const SECTION_TITLE = {fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 10};
const SUB = {fontSize: 12, color: '#6b7280'};
const INP = {
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '7px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  width: '100%',
  boxSizing: 'border-box',
  background: 'white',
  color: '#111827',
};
const LBL = {display: 'block', fontSize: 12, color: '#374151', marginBottom: 4, fontWeight: 500};
const PRIMARY_BTN = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#085041',
  color: 'white',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const SECONDARY_BTN = {
  ...PRIMARY_BTN,
  background: 'white',
  color: '#374151',
  border: '1px solid #d1d5db',
};
const DANGER_BTN = {
  ...PRIMARY_BTN,
  background: '#fee2e2',
  color: '#991b1b',
  border: '1px solid #fecaca',
};

const RECURRENCE_LABELS = {
  once: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

function emptyTemplateForm() {
  return {
    id: '',
    title: '',
    description: '',
    assignee_profile_id: '',
    recurrence: 'once',
    recurrence_interval: 1,
    first_due_date: '',
    notes: '',
    active: false,
  };
}

function mintTemplateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'tt-' + crypto.randomUUID().replace(/-/g, '');
  }
  // Fallback for environments without crypto.randomUUID — Date+random is
  // collision-safe enough for an admin-only mint path.
  return 'tt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export default function AdminTasksView({Header, sb, allUsers, loadUsers, setView}) {
  const [templates, setTemplates] = React.useState([]);
  const [openInstances, setOpenInstances] = React.useState([]);
  const [cronTail, setCronTail] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');

  const [editForm, setEditForm] = React.useState(null); // null = closed
  const [saving, setSaving] = React.useState(false);

  const [runningCron, setRunningCron] = React.useState(false);
  const [cronResult, setCronResult] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setErr('');
    try {
      const [tpls, opens, audit] = await Promise.all([
        loadTaskTemplates(sb),
        loadOpenTaskInstances(sb),
        loadCronAuditTail(sb, 5),
      ]);
      setTemplates(tpls);
      setOpenInstances(opens);
      setCronTail(audit);
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sb]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Hydrate the assignee dropdown source. allUsers lives in AuthContext but
  // is only populated when something explicitly calls loadUsers (e.g. the
  // Header → Users modal opens it). Direct navigation to /admin/tasks (URL
  // bar / bookmark / page reload) bypasses the Header click, so we kick the
  // load here on mount when the array is empty. Idempotent — loadUsers is
  // a plain `select * from profiles` and re-running it just refreshes state.
  React.useEffect(() => {
    if (typeof loadUsers !== 'function') return;
    if (Array.isArray(allUsers) && allUsers.length > 0) return;
    loadUsers();
    // Intentionally fire-once on mount; allUsers transitions from [] to
    // populated once the load resolves and the context propagates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eligible assignees = profiles with role !== 'inactive'. The dropdown
  // sources from useAuth().allUsers per PROJECT.md §8 plan rev 5. Sort by
  // full_name for stable rendering.
  const eligibleAssignees = React.useMemo(() => {
    const list = Array.isArray(allUsers) ? allUsers : [];
    return list
      .filter((u) => u && u.id && u.role !== 'inactive')
      .slice()
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [allUsers]);

  function startNew() {
    const f = emptyTemplateForm();
    if (eligibleAssignees.length > 0) f.assignee_profile_id = eligibleAssignees[0].id;
    setEditForm(f);
  }

  function startEdit(tpl) {
    setEditForm({
      id: tpl.id,
      title: tpl.title || '',
      description: tpl.description || '',
      assignee_profile_id: tpl.assignee_profile_id || '',
      recurrence: tpl.recurrence || 'once',
      recurrence_interval: tpl.recurrence_interval || 1,
      first_due_date: tpl.first_due_date || '',
      notes: tpl.notes || '',
      active: !!tpl.active,
    });
  }

  function closeEdit() {
    setEditForm(null);
  }

  async function saveTemplate() {
    if (!editForm) return;
    if (!editForm.title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (!editForm.assignee_profile_id) {
      setErr('Assignee is required.');
      return;
    }
    if (!editForm.first_due_date) {
      setErr('First due date is required.');
      return;
    }
    const interval = parseInt(editForm.recurrence_interval, 10);
    if (!Number.isFinite(interval) || interval < 1) {
      setErr('Recurrence interval must be at least 1.');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      const payload = {
        id: editForm.id || mintTemplateId(),
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        assignee_profile_id: editForm.assignee_profile_id,
        recurrence: editForm.recurrence,
        recurrence_interval: interval,
        first_due_date: editForm.first_due_date,
        notes: editForm.notes.trim() || null,
        active: !!editForm.active,
      };
      await upsertTaskTemplate(sb, payload);
      closeEdit();
      await refresh();
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(tpl) {
    if (!confirm(`Delete template "${tpl.title}"? This cannot be undone.`)) return;
    setErr('');
    try {
      await deleteTaskTemplate(sb, tpl.id);
      await refresh();
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    }
  }

  async function handleRunCronNow() {
    setRunningCron(true);
    setCronResult(null);
    setErr('');
    try {
      const result = await runCronNow(sb);
      setCronResult(result);
      await refresh();
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    } finally {
      setRunningCron(false);
    }
  }

  function nameOf(profileId) {
    if (!profileId) return '—';
    const u = (allUsers || []).find((x) => x && x.id === profileId);
    return (u && (u.full_name || u.email)) || profileId.slice(0, 8) + '…';
  }

  return (
    <div style={PAGE_BG}>
      {Header ? <Header /> : null}

      <div style={{maxWidth: 1100, margin: '0 auto', padding: '16px 18px'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14}}>
          <div>
            <h1 style={{fontSize: 20, margin: 0, color: '#111827'}}>Tasks Center</h1>
            <div style={SUB}>
              Admin-only. Templates generate task instances daily; assignees complete via /my-tasks.
            </div>
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button
              type="button"
              onClick={() => setView && setView('webforms')}
              style={SECONDARY_BTN}
              title="Manage Team Roster lives in the existing Webforms admin"
            >
              Manage Team Roster
            </button>
            <button type="button" onClick={handleRunCronNow} disabled={runningCron} style={PRIMARY_BTN}>
              {runningCron ? 'Running…' : 'Run Cron Now'}
            </button>
          </div>
        </div>

        {err && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {cronResult && (
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            Cron run complete — generated: {Number(cronResult.generated_count) || 0} · skipped:{' '}
            {Number(cronResult.skipped_count) || 0}
            {Array.isArray(cronResult.cap_exceeded) && cronResult.cap_exceeded.length > 0
              ? ` · cap exceeded for ${cronResult.cap_exceeded.length} template(s)`
              : ''}
          </div>
        )}

        {/* ── Templates ─────────────────────────────────────────────── */}
        <div style={CARD}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8}}>
            <div style={SECTION_TITLE}>Task templates</div>
            <button type="button" onClick={startNew} style={PRIMARY_BTN}>
              + New template
            </button>
          </div>
          {loading ? (
            <div style={SUB}>Loading…</div>
          ) : templates.length === 0 ? (
            <div style={SUB}>No templates yet. Create one to schedule recurring tasks.</div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.4fr 1fr 1fr auto',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: tpl.active ? 'white' : '#f9fafb',
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{fontWeight: 600, color: '#111827'}}>{tpl.title}</div>
                    {tpl.description && <div style={SUB}>{tpl.description}</div>}
                  </div>
                  <div style={{color: '#374151'}}>{nameOf(tpl.assignee_profile_id)}</div>
                  <div style={{color: '#374151'}}>
                    {RECURRENCE_LABELS[tpl.recurrence] || tpl.recurrence}
                    {tpl.recurrence_interval > 1 ? ` ×${tpl.recurrence_interval}` : ''}
                  </div>
                  <div style={{color: tpl.active ? '#065f46' : '#9ca3af', fontWeight: 600}}>
                    {tpl.active ? 'ACTIVE' : 'inactive'}
                  </div>
                  <div style={{display: 'flex', gap: 6}}>
                    <button type="button" onClick={() => startEdit(tpl)} style={SECONDARY_BTN}>
                      Edit
                    </button>
                    <button type="button" onClick={() => removeTemplate(tpl)} style={DANGER_BTN}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Open task instances ──────────────────────────────────── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Open task instances ({openInstances.length})</div>
          {loading ? (
            <div style={SUB}>Loading…</div>
          ) : openInstances.length === 0 ? (
            <div style={SUB}>No open tasks. The next 04:00 UTC cron fire will generate any due ones.</div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
              {openInstances.map((ti) => (
                <div
                  key={ti.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 2fr 1.4fr 1fr',
                    gap: 8,
                    padding: '6px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <div style={{color: '#6b7280'}}>{ti.due_date}</div>
                  <div style={{color: '#111827', fontWeight: 500}}>{ti.title}</div>
                  <div style={{color: '#374151'}}>{nameOf(ti.assignee_profile_id)}</div>
                  <div style={SUB}>{ti.submission_source || 'generated'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Cron audit footer ────────────────────────────────────── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Last 5 cron audit rows (task_cron_runs)</div>
          {loading ? (
            <div style={SUB}>Loading…</div>
          ) : cronTail.length === 0 ? (
            <div style={SUB}>No cron audit rows yet.</div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
              {cronTail.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '170px 80px 1fr 1fr 2fr',
                    gap: 8,
                    padding: '6px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    fontSize: 11,
                    color: '#374151',
                  }}
                >
                  <div>{row.ran_at}</div>
                  <div>{row.run_mode}</div>
                  <div>generated {row.generated_count ?? 0}</div>
                  <div>skipped {row.skipped_count ?? 0}</div>
                  <div style={{color: row.error_message ? '#991b1b' : '#9ca3af'}}>{row.error_message || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Create/Edit template modal ─────────────────────────────── */}
      {editForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={closeEdit}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 18,
              width: 'min(560px, 92vw)',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          >
            <div style={{fontSize: 16, fontWeight: 700, marginBottom: 12}}>
              {editForm.id ? 'Edit template' : 'New template'}
            </div>

            <div style={{marginBottom: 10}}>
              <label style={LBL}>Title *</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                style={INP}
              />
            </div>

            <div style={{marginBottom: 10}}>
              <label style={LBL}>Description</label>
              <textarea
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                style={{...INP, resize: 'vertical', fontFamily: 'inherit'}}
              />
            </div>

            <div style={{marginBottom: 10}}>
              <label style={LBL}>Assignee *</label>
              <select
                value={editForm.assignee_profile_id}
                onChange={(e) => setEditForm({...editForm, assignee_profile_id: e.target.value})}
                style={INP}
              >
                <option value="">Select…</option>
                {eligibleAssignees.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email || u.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10}}>
              <div>
                <label style={LBL}>Recurrence *</label>
                <select
                  value={editForm.recurrence}
                  onChange={(e) => setEditForm({...editForm, recurrence: e.target.value})}
                  style={INP}
                >
                  {RECURRENCE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABELS[r] || r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={LBL}>Interval *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editForm.recurrence_interval}
                  onChange={(e) => setEditForm({...editForm, recurrence_interval: e.target.value})}
                  style={INP}
                />
              </div>
              <div>
                <label style={LBL}>First due *</label>
                <input
                  type="date"
                  value={editForm.first_due_date}
                  onChange={(e) => setEditForm({...editForm, first_due_date: e.target.value})}
                  style={INP}
                />
              </div>
            </div>

            <div style={{marginBottom: 10}}>
              <label style={LBL}>Notes</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                style={{...INP, resize: 'vertical', fontFamily: 'inherit'}}
              />
            </div>

            <label style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer'}}>
              <input
                type="checkbox"
                checked={editForm.active}
                onChange={(e) => setEditForm({...editForm, active: e.target.checked})}
              />
              <span style={{fontSize: 13, color: '#374151'}}>Active (cron generates instances when checked)</span>
            </label>

            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
              <button type="button" onClick={closeEdit} style={SECONDARY_BTN}>
                Cancel
              </button>
              <button type="button" onClick={saveTemplate} disabled={saving} style={PRIMARY_BTN}>
                {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
