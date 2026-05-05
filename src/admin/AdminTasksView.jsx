import React from 'react';
import {RECURRENCE_OPTIONS, visiblePublicAssignees} from '../lib/tasks.js';
import {
  loadTaskTemplates,
  loadOpenTaskInstances,
  upsertTaskTemplate,
  deleteTaskTemplate,
  createOneTimeTaskInstance,
  loadPublicAssigneeAvailability,
} from '../lib/tasksAdminApi.js';

// Admin Tasks Center — C1 + C1.1 (product-correction round).
// Sections (admin-only; see UnauthorizedRedirect wrapper at the route mount):
//   1. Recurring Tasks list + edit modal (existing task_templates)
//   2. Open Tasks list (task_instances; both generated + admin_manual)
//   3. New Task modal: defaults to one-time mode; "Make recurring" toggle
//      reveals the recurrence/interval/first-due/active fields and switches
//      the save path from task_instances (admin_manual) to task_templates.
//
// Cron infrastructure (Edge Function, schedule, audit table) stays intact;
// it just isn't surfaced on the operator UI anymore. Run Cron Now and the
// task_cron_runs audit footer were removed in C1.1.
//
// `requires_photo` is intentionally absent from every form here — that
// column was dropped from task_templates + task_instances by mig 039.

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

// Modal default = one-time mode. The "Make recurring" toggle below the
// always-visible fields gates the recurrence-specific fields. Same form
// state covers both branches; `dueDate` maps to task_instances.due_date in
// one-time mode and task_templates.first_due_date in recurring mode at
// save time.
//
// `oneTimeInstanceId` is minted once at modal-open time and reused on every
// Save attempt within that modal session. If the first Save errors mid-flight
// and the user clicks Save again, the second attempt carries the same id —
// so a replay against the row that did land (idempotency in
// createOneTimeTaskInstance) returns it rather than creating a duplicate.
// Closing and re-opening the modal mints a fresh id for the next session.
function emptyTaskForm() {
  return {
    recurring: false,
    id: '',
    oneTimeInstanceId: '',
    title: '',
    description: '',
    assignee_profile_id: '',
    dueDate: '',
    recurrence: 'once',
    recurrence_interval: 1,
    notes: '',
    active: false,
  };
}

function mintTemplateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'tt-' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'tt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function mintInstanceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'ti-' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'ti-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export default function AdminTasksView({Header, sb, allUsers, loadUsers, setView}) {
  const [templates, setTemplates] = React.useState([]);
  const [openInstances, setOpenInstances] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');

  const [editForm, setEditForm] = React.useState(null); // null = closed
  const [saving, setSaving] = React.useState(false);

  // Public-Tasks assignee availability (webform_config.tasks_public_assignee_availability).
  // Codex C3.1a hotfix: the same hidden-profile-ids list that gates the
  // /webforms/tasks Assign-to dropdown also applies to this admin view.
  // Hiding a planner user in the Public Tasks tile must hide them from
  // BOTH dropdowns.
  const [assigneeAvailability, setAssigneeAvailability] = React.useState({hiddenProfileIds: []});

  const refresh = React.useCallback(async () => {
    setErr('');
    try {
      const [tpls, opens, av] = await Promise.all([
        loadTaskTemplates(sb),
        loadOpenTaskInstances(sb),
        loadPublicAssigneeAvailability(sb),
      ]);
      setTemplates(tpls);
      setOpenInstances(opens);
      setAssigneeAvailability(av);
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

  // Eligible assignees = active profiles minus the
  // tasks_public_assignee_availability hidden-list. The hidden-list gates
  // BOTH the /webforms/tasks Assign-to dropdown AND this admin view —
  // hiding a user in the admin Public Tasks tile must hide them
  // everywhere a task can be assigned. Sort by full_name for stable
  // rendering.
  const eligibleAssignees = React.useMemo(() => {
    const list = Array.isArray(allUsers) ? allUsers : [];
    const active = list.filter((u) => u && u.id && u.role !== 'inactive');
    const visible = visiblePublicAssignees(active, assigneeAvailability);
    return visible.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [allUsers, assigneeAvailability]);

  // Coerce the open modal's selected assignee to a visible one. Three
  // entry paths reach here, all handled by depending on BOTH
  // eligibleAssignees AND editForm?.assignee_profile_id (Codex C3.1a
  // hotfix re-review):
  //   (a) availability config loads AFTER startNew already preselected
  //       a now-hidden user → eligibleAssignees changes → effect
  //       re-pins.
  //   (b) admin hides the currently-selected assignee in another tab
  //       while the modal is open → same as (a).
  //   (c) startEditTemplate copies a template's hidden
  //       assignee_profile_id into editForm without changing
  //       eligibleAssignees → editForm.assignee_profile_id changes →
  //       effect re-pins.
  // If the form is open with no assignee but visible options exist,
  // preselect the first one (covers the "modal opened before
  // eligibleAssignees populated" race).
  React.useEffect(() => {
    if (!editForm) return;
    const firstVisible = eligibleAssignees[0]?.id || '';
    if (!editForm.assignee_profile_id) {
      if (firstVisible) {
        setEditForm((prev) => (prev ? {...prev, assignee_profile_id: firstVisible} : prev));
      }
      return;
    }
    const stillEligible = eligibleAssignees.some((u) => u.id === editForm.assignee_profile_id);
    if (stillEligible) return;
    setEditForm((prev) => (prev ? {...prev, assignee_profile_id: firstVisible} : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on assignee_profile_id only; full editForm would re-fire on every title/description keystroke
  }, [eligibleAssignees, editForm?.assignee_profile_id]);

  function startNew() {
    const f = emptyTaskForm();
    f.oneTimeInstanceId = mintInstanceId();
    if (eligibleAssignees.length > 0) f.assignee_profile_id = eligibleAssignees[0].id;
    setEditForm(f);
  }

  function startEditTemplate(tpl) {
    setEditForm({
      recurring: true, // editing an existing template ⇒ recurring branch
      id: tpl.id,
      title: tpl.title || '',
      description: tpl.description || '',
      assignee_profile_id: tpl.assignee_profile_id || '',
      dueDate: tpl.first_due_date || '',
      recurrence: tpl.recurrence || 'once',
      recurrence_interval: tpl.recurrence_interval || 1,
      notes: tpl.notes || '',
      active: !!tpl.active,
    });
  }

  function closeEdit() {
    setEditForm(null);
  }

  async function saveTask() {
    if (!editForm) return;
    if (!editForm.title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (!editForm.assignee_profile_id) {
      setErr('Assignee is required.');
      return;
    }
    if (!editForm.dueDate) {
      setErr(editForm.recurring ? 'First due date is required.' : 'Due date is required.');
      return;
    }
    if (editForm.recurring) {
      const interval = parseInt(editForm.recurrence_interval, 10);
      if (!Number.isFinite(interval) || interval < 1) {
        setErr('Recurrence interval must be at least 1.');
        return;
      }
    }
    setErr('');
    setSaving(true);
    try {
      if (editForm.recurring) {
        // Recurring: upsert task_templates. Cron generator picks up active
        // templates and writes task_instances on its 04:00 UTC fire.
        const payload = {
          id: editForm.id || mintTemplateId(),
          title: editForm.title.trim(),
          description: editForm.description.trim() || null,
          assignee_profile_id: editForm.assignee_profile_id,
          recurrence: editForm.recurrence,
          recurrence_interval: parseInt(editForm.recurrence_interval, 10),
          first_due_date: editForm.dueDate,
          notes: editForm.notes.trim() || null,
          active: !!editForm.active,
        };
        await upsertTaskTemplate(sb, payload);
      } else {
        // One-time: insert a single task_instances row directly.
        // template_id null + submission_source='admin_manual' per spec.
        // `id` is the form-held oneTimeInstanceId minted when the modal
        // opened — stable across Save retries inside the same modal
        // session so a network-blip retry doesn't double-insert.
        const payload = {
          id: editForm.oneTimeInstanceId,
          template_id: null,
          assignee_profile_id: editForm.assignee_profile_id,
          due_date: editForm.dueDate,
          title: editForm.title.trim(),
          description: editForm.description.trim() || null,
          submission_source: 'admin_manual',
          status: 'open',
        };
        await createOneTimeTaskInstance(sb, payload);
      }
      closeEdit();
      await refresh();
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(tpl) {
    if (!confirm(`Delete recurring task "${tpl.title}"? This cannot be undone.`)) return;
    setErr('');
    try {
      await deleteTaskTemplate(sb, tpl.id);
      await refresh();
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    }
  }

  function nameOf(profileId) {
    if (!profileId) return '—';
    const u = (allUsers || []).find((x) => x && x.id === profileId);
    return (u && (u.full_name || u.email)) || profileId.slice(0, 8) + '…';
  }

  const isEditingTemplate = !!(editForm && editForm.id);
  const modalTitle = isEditingTemplate
    ? 'Edit Recurring Task'
    : editForm && editForm.recurring
      ? 'New Recurring Task'
      : 'New Task';

  return (
    <div style={PAGE_BG}>
      {Header ? <Header /> : null}

      <div style={{maxWidth: 1100, margin: '0 auto', padding: '16px 18px'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14}}>
          <div>
            <h1 style={{fontSize: 20, margin: 0, color: '#111827'}}>Tasks Center</h1>
            <div style={SUB}>Admin-only. Manage one-time tasks and recurring tasks.</div>
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
            <button type="button" onClick={startNew} style={PRIMARY_BTN}>
              + New Task
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

        {/* ── Open Tasks ──────────────────────────────────────────── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Open Tasks ({openInstances.length})</div>
          {loading ? (
            <div style={SUB}>Loading…</div>
          ) : openInstances.length === 0 ? (
            <div style={SUB}>No open tasks.</div>
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

        {/* ── Recurring Tasks ─────────────────────────────────────── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Recurring Tasks</div>
          {loading ? (
            <div style={SUB}>Loading…</div>
          ) : templates.length === 0 ? (
            <div style={SUB}>No recurring tasks yet.</div>
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
                    <button type="button" onClick={() => startEditTemplate(tpl)} style={SECONDARY_BTN}>
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
      </div>

      {/* ── New / Edit Task modal ──────────────────────────────────── */}
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
            <div style={{fontSize: 16, fontWeight: 700, marginBottom: 12}}>{modalTitle}</div>

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

            <div style={{marginBottom: 10}}>
              <label style={LBL}>{editForm.recurring ? 'First due *' : 'Due date *'}</label>
              <input
                type="date"
                value={editForm.dueDate}
                onChange={(e) => setEditForm({...editForm, dueDate: e.target.value})}
                style={INP}
              />
            </div>

            {/* Repeat-this-task toggle (C3.1a hotfix): plain compact row.
                NO bordered card. Checkbox sits immediately beside its
                label with a small gap. Helper copy aligns under the
                label text. Hidden when editing an existing template
                (you can't toggle a template back to a single
                instance — that would require deleting the template +
                creating an instance). */}
            {!isEditingTemplate && (
              <div style={{marginBottom: 12}}>
                <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}>
                  <input
                    type="checkbox"
                    checked={editForm.recurring}
                    onChange={(e) => setEditForm({...editForm, recurring: e.target.checked})}
                    style={{margin: 0}}
                  />
                  <span style={{fontSize: 13, color: '#374151'}}>Repeat this task</span>
                </label>
                <div style={{fontSize: 11, color: '#6b7280', marginLeft: 24, marginTop: 4, lineHeight: 1.4}}>
                  Creates scheduled tasks automatically. One-time tasks appear in Open Tasks immediately.
                </div>
              </div>
            )}

            {editForm.recurring && (
              <>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10}}>
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
                </div>

                <label style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer'}}>
                  <input
                    type="checkbox"
                    checked={editForm.active}
                    onChange={(e) => setEditForm({...editForm, active: e.target.checked})}
                  />
                  <span style={{fontSize: 13, color: '#374151'}}>Active (generate due instances on schedule)</span>
                </label>
              </>
            )}

            <div style={{marginBottom: 14}}>
              <label style={LBL}>Notes</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                style={{...INP, resize: 'vertical', fontFamily: 'inherit'}}
              />
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
              <button type="button" onClick={closeEdit} style={SECONDARY_BTN}>
                Cancel
              </button>
              <button type="button" onClick={saveTask} disabled={saving} style={PRIMARY_BTN}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
