// /my-tasks — assignee's open task list + completion flow (C2).
// Auth-gated (NOT admin-only). Wrapped in UnauthorizedRedirect with
// requireAdmin: false at the route mount; non-admins land here just
// fine.
//
// Reads task_instances where assignee_profile_id = authState.user.id
// AND status='open' (mig 037 task_instances_assignee_self_select RLS
// covers this query). Renders title / description / due date /
// submitted-by / source. When the row carries a request_photo_path
// (from C3.1b), a small "Request photo" link does a lazy-fetch signed
// URL.
//
// Completion flow:
//   - optional photo input
//   - synchronous upload to task-photos bucket (upsert:false +
//     duplicate-as-success — the bucket is append-only by policy
//     per Codex C2 review)
//   - sb.rpc('complete_task_instance', {p_instance_id,
//     p_completion_photo_path}) — mig 040 owns the auth + path-shape
//     validation server-side
//   - on success the row drops out of the open list
//
// The completion photo path is built from ti.assignee_profile_id, NOT
// authState.user.id (Codex C2 amendment 2). They're equal when the
// assignee is completing their own task, but using the row field
// keeps the client/server contracts aligned and is safe for any
// future admin-completes-someone-else's-task surface.
//
// All side-effect wrappers come from src/lib/tasksUserApi.js. This
// view does NOT import from tasksAdminApi.js (Codex C2 amendment 3).

import React from 'react';
import {
  loadOpenTasksForAssignee,
  uploadCompletionPhoto,
  completeTaskInstance,
  getRequestPhotoSignedUrl,
} from '../lib/tasksUserApi.js';

const PAGE_BG = {
  minHeight: '100vh',
  background: '#f9fafb',
  fontFamily: 'inherit',
};
const CARD = {
  background: 'white',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  border: '1px solid #e5e7eb',
};
const SUB = {fontSize: 12, color: '#6b7280'};
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

export default function MyTasksView({Header, sb, authState}) {
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');
  // Per-row state, keyed by ti.id.
  const [photos, setPhotos] = React.useState({}); // {tiId: File}
  const [completing, setCompleting] = React.useState({}); // {tiId: bool}

  const callerProfileId = authState && authState.user ? authState.user.id : null;

  const refresh = React.useCallback(async () => {
    setErr('');
    try {
      const list = await loadOpenTasksForAssignee(sb, callerProfileId);
      setTasks(list);
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sb, callerProfileId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  function setPhotoForTask(tiId, file) {
    setPhotos((prev) => ({...prev, [tiId]: file}));
  }

  function clearPhotoForTask(tiId) {
    setPhotos((prev) => {
      const next = {...prev};
      delete next[tiId];
      return next;
    });
  }

  async function openRequestPhoto(dbPath) {
    setErr('');
    try {
      const url = await getRequestPhotoSignedUrl(sb, dbPath);
      if (!url) {
        setErr('Request photo path missing or malformed.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr('Could not open request photo: ' + (e && e.message ? e.message : String(e)));
    }
  }

  async function handleComplete(ti) {
    setErr('');
    setCompleting((prev) => ({...prev, [ti.id]: true}));
    try {
      // Codex C2 amendment 2: build the path from the row's
      // assignee_profile_id, NOT authState.user.id. They're equal here
      // (assignees only see their own rows under
      // task_instances_assignee_self_select), but keeping the source
      // of truth aligned with the RPC's server-side validation makes
      // future admin-completes-someone-else paths safe.
      let completionPhotoDbPath = null;
      const file = photos[ti.id];
      if (file) {
        completionPhotoDbPath = await uploadCompletionPhoto(sb, ti.assignee_profile_id, ti.id, file);
      }
      await completeTaskInstance(sb, ti.id, completionPhotoDbPath);
      // Refresh the list — the completed row drops out.
      clearPhotoForTask(ti.id);
      await refresh();
    } catch (e) {
      setErr('Could not complete task: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setCompleting((prev) => {
        const next = {...prev};
        delete next[ti.id];
        return next;
      });
    }
  }

  return (
    <div style={PAGE_BG}>
      {Header ? <Header /> : null}
      <div style={{maxWidth: 720, margin: '0 auto', padding: '16px 18px'}}>
        <div style={{marginBottom: 14}}>
          <h1 style={{fontSize: 20, margin: 0, color: '#111827'}}>My Tasks</h1>
          <div style={SUB}>Tasks assigned to you. Mark complete when done.</div>
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

        {loading ? (
          <div style={SUB}>Loading…</div>
        ) : tasks.length === 0 ? (
          <div style={CARD}>
            <div style={{fontSize: 13, color: '#374151'}}>Nothing assigned to you right now.</div>
          </div>
        ) : (
          tasks.map((ti) => {
            const file = photos[ti.id];
            const isCompleting = !!completing[ti.id];
            return (
              <div key={ti.id} data-task-row={ti.id} style={CARD}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10}}>
                  <div style={{fontSize: 15, fontWeight: 600, color: '#111827', flex: 1}}>{ti.title}</div>
                  <div style={{...SUB, whiteSpace: 'nowrap'}}>{ti.due_date}</div>
                </div>
                {ti.description && (
                  <div style={{fontSize: 13, color: '#374151', marginTop: 4, whiteSpace: 'pre-wrap'}}>
                    {ti.description}
                  </div>
                )}
                <div style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8}}>
                  <span style={SUB}>
                    Source: <span style={{color: '#374151'}}>{ti.submission_source || 'generated'}</span>
                  </span>
                  {ti.submitted_by_team_member && (
                    <span style={SUB}>
                      Submitted by: <span style={{color: '#374151'}}>{ti.submitted_by_team_member}</span>
                    </span>
                  )}
                  {ti.request_photo_path && (
                    <button
                      type="button"
                      data-request-photo-link={ti.id}
                      onClick={() => openRequestPhoto(ti.request_photo_path)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#085041',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      📎 Request photo
                    </button>
                  )}
                </div>

                <div style={{marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e5e7eb'}}>
                  <div style={{fontSize: 12, color: '#6b7280', marginBottom: 6}}>Completion photo (optional)</div>
                  {file ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                      <span
                        style={{fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis'}}
                      >
                        📎 {file.name || 'photo.jpg'} ({Math.round((file.size || 0) / 1024)} KB)
                      </span>
                      <button type="button" onClick={() => clearPhotoForTask(ti.id)} style={SECONDARY_BTN}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        if (f) setPhotoForTask(ti.id, f);
                      }}
                      style={{
                        fontSize: 13,
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 6,
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 12}}>
                  <button
                    type="button"
                    data-task-complete={ti.id}
                    onClick={() => handleComplete(ti)}
                    disabled={isCompleting}
                    style={{
                      ...PRIMARY_BTN,
                      opacity: isCompleting ? 0.6 : 1,
                      cursor: isCompleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isCompleting ? 'Completing…' : 'Mark complete'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
