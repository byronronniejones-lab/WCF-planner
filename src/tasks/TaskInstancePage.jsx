import React from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import RecordCollaborationSection from '../shared/RecordCollaborationSection.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import RecordSequenceNav from '../shared/RecordSequenceNav.jsx';
import {recordSeqNavOptions} from '../lib/recordSequence.js';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import InlineNotice from '../shared/InlineNotice.jsx';
import RecordPageLoadError from '../shared/RecordPageLoadError.jsx';
/* eslint-disable no-unused-vars -- shell primitives are used in JSX only */
import {
  RecordPageFrame,
  RecordPageLoading,
  RecordPageNotFound,
  RecordPageBody,
  RecordBackLink,
  RecordTitle,
} from '../shared/RecordPageShell.jsx';
/* eslint-enable no-unused-vars */
import {
  recordFormCard,
  recordFieldRowClass,
  recordFieldLabel,
  recordControl,
  recordTextarea,
  recordSaveButton,
  recordSecondaryButton,
  recordDeleteButton,
} from '../shared/recordPageControls.jsx';
import {fireActivityChangeEvent} from '../lib/activityApi.js';
import {
  loadTaskInstanceById,
  loadTaskInstancePhotos,
  loadEligibleProfilesById,
  loadTaskAssignableProfilesById,
  attributionFor,
  dueStateFor,
  photoPresenceFor,
} from '../lib/tasksCenterApi.js';
import {
  MAX_TASK_PHOTOS_PER_TASK,
  TASK_CHANGE_EVENT,
  fireTaskChangeEvent,
  remainingTaskPhotoSlots,
  updateTaskInstanceDetailsV2,
  uploadTaskCreationPhotos,
} from '../lib/tasksCenterMutationsApi.js';
import {fmt, fmtCentralDateTime, todayCentralISO} from '../lib/dateUtils.js';
import CompleteTaskModal from './CompleteTaskModal.jsx';
import TaskPhotoLightbox from './TaskPhotoLightbox.jsx';
import EditDueDateModal from './EditDueDateModal.jsx';
import AssignTaskModal from './AssignTaskModal.jsx';
import DeleteTaskModal from './DeleteTaskModal.jsx';

const BADGE_BASE = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  marginLeft: 6,
};
const BADGE_RECURRING = {...BADGE_BASE, background: '#eef2ff', color: '#3730a3'};
const BADGE_SYSTEM = {...BADGE_BASE, background: '#ecfdf5', color: '#047857'};
const TASK_ENTITY_TYPE = 'task.instance';

function taskPhotoCounts(task, photoRows) {
  const paths = new Set();
  let creation = 0;
  for (const row of photoRows || []) {
    const key = row && (row.storage_path || row.id);
    if (key) paths.add(key);
    if (row && row.kind === 'creation') creation += 1;
  }
  if (task?.request_photo_path) {
    paths.add(task.request_photo_path);
    if (creation === 0) creation = 1;
  }
  if (task?.completion_photo_path) paths.add(task.completion_photo_path);
  return {total: paths.size, creation};
}

export default function TaskInstancePage({sb, authState, Header}) {
  const navigate = useNavigate();
  const location = useLocation();
  const recordId = location.pathname.replace('/tasks/', '');
  // Originating list order handed through route state; absent on direct links,
  // legacy ?task redirects, and notification deep-links.
  const recordSeq = location.state?.recordSeq || null;
  function navigateSeq(id) {
    navigate('/tasks/' + id, recordSeqNavOptions(recordSeq));
  }

  const [record, setRecord] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);
  const [profiles, setProfiles] = React.useState({});
  const [assignableProfiles, setAssignableProfiles] = React.useState({});
  const [recordPhotoRows, setRecordPhotoRows] = React.useState([]);

  const [completeTarget, setCompleteTarget] = React.useState(null);
  const [editDueTarget, setEditDueTarget] = React.useState(null);
  const [assignTarget, setAssignTarget] = React.useState(null);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [photoTarget, setPhotoTarget] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editingDetails, setEditingDetails] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editDueDate, setEditDueDate] = React.useState('');
  const [editAssigneeId, setEditAssigneeId] = React.useState('');
  const [editPhotos, setEditPhotos] = React.useState([]);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState('');

  const callerProfileId = authState && authState.user ? authState.user.id : null;
  const isAdmin = authState && authState.role === 'admin';
  const editProfileOptions = React.useMemo(() => {
    const map = new Map();
    for (const p of Object.values(assignableProfiles || {})) {
      if (p && p.id && p.full_name) map.set(p.id, p);
    }
    const current = record?.assignee_profile_id ? profiles[record.assignee_profile_id] : null;
    if (current && current.id && current.full_name && !map.has(current.id)) {
      map.set(current.id, current);
    }
    return Array.from(map.values()).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [assignableProfiles, profiles, record?.assignee_profile_id]);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [task, profMap, assignableMap] = await Promise.all([
        loadTaskInstanceById(sb, recordId),
        loadEligibleProfilesById(sb),
        loadTaskAssignableProfilesById(sb),
      ]);
      const photoRows = task ? await loadTaskInstancePhotos(sb, recordId).catch(() => []) : [];
      setRecord(task || null);
      setProfiles(profMap || {});
      setAssignableProfiles(assignableMap || {});
      setRecordPhotoRows(photoRows || []);
    } catch (e) {
      setRecord(null);
      setProfiles({});
      setAssignableProfiles({});
      setRecordPhotoRows([]);
      setLoadError({
        kind: 'error',
        message: 'Could not load task record. Please refresh the page. (' + ((e && e.message) || e) + ')',
      });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    setRecord(null);
    setRecordPhotoRows([]);
    setLoading(true);
    setNotice(null);
    setLoadError(null);
    setEditingDetails(false);
    setEditPhotos([]);
    setEditError('');
    setEditSaving(false);
    loadAll();
  }, [recordId, reloadKey]);

  React.useEffect(() => {
    if (!loading && location.hash) {
      const anchor = location.hash.slice(1);
      setTimeout(() => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, 200);
    }
  }, [loading, location.hash]);

  React.useEffect(() => {
    function onChange() {
      setReloadKey((k) => k + 1);
    }
    window.addEventListener(TASK_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(TASK_CHANGE_EVENT, onChange);
  }, []);

  function canComplete(ti) {
    if (!ti || ti.status !== 'open') return false;
    if (isAdmin) return true;
    return !!(callerProfileId && ti.assignee_profile_id === callerProfileId);
  }

  function canEditDue(ti) {
    if (!ti || ti.status !== 'open') return false;
    if (isAdmin) return true;
    return !!(callerProfileId && ti.assignee_profile_id === callerProfileId);
  }

  function canEditDetails(ti) {
    if (!ti || ti.status !== 'open') return false;
    if (isAdmin) return true;
    return !!(callerProfileId && ti.created_by_profile_id === callerProfileId);
  }

  function canAssign(ti) {
    if (!ti || ti.status !== 'open') return false;
    return !!isAdmin;
  }

  function canDelete(ti) {
    if (!ti || ti.status !== 'open') return false;
    if (isAdmin) return true;
    return !!(
      callerProfileId &&
      ti.created_by_profile_id === callerProfileId &&
      ti.assignee_profile_id === callerProfileId
    );
  }

  function startEditDetails() {
    if (!record || !canEditDetails(record)) return;
    setEditTitle(record.title || '');
    setEditDescription(record.description || '');
    setEditDueDate(record.due_date || '');
    setEditAssigneeId(record.assignee_profile_id || '');
    setEditPhotos([]);
    setEditError('');
    setEditingDetails(true);
  }

  function stopEditDetails() {
    setEditPhotos([]);
    setEditError('');
    setEditSaving(false);
    setEditingDetails(false);
  }

  function addEditPhotos(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
    if (files.length === 0) return;
    const counts = taskPhotoCounts(record, recordPhotoRows);
    const available = Math.max(0, remainingTaskPhotoSlots(counts.total) - editPhotos.length);
    if (available <= 0) {
      setEditError(`Tasks can have up to ${MAX_TASK_PHOTOS_PER_TASK} photos.`);
      return;
    }
    setEditPhotos([...editPhotos, ...files.slice(0, available)]);
    if (files.length > available) {
      setEditError(`Tasks can have up to ${MAX_TASK_PHOTOS_PER_TASK} photos.`);
    }
  }

  async function saveEditDetails() {
    if (!record || editSaving) return;
    setEditError('');
    if (editTitle.trim().length < 3) {
      setEditError('Title must be at least 3 characters.');
      return;
    }
    if (!editDueDate) {
      setEditError('Due date is required.');
      return;
    }
    if (!editAssigneeId) {
      setEditError('Assignee is required.');
      return;
    }

    const counts = taskPhotoCounts(record, recordPhotoRows);
    const remaining = remainingTaskPhotoSlots(counts.total);
    if (editPhotos.length > remaining) {
      setEditError(`Tasks can have up to ${MAX_TASK_PHOTOS_PER_TASK} photos.`);
      return;
    }

    setEditSaving(true);
    try {
      const photoPaths = await uploadTaskCreationPhotos(sb, record.id, editPhotos, {
        existingCreationCount: counts.creation,
        existingPhotoCount: counts.total,
      });
      await updateTaskInstanceDetailsV2(sb, {
        id: record.id,
        title: editTitle.trim(),
        description: editDescription,
        dueDate: editDueDate,
        assigneeProfileId: editAssigneeId,
        creationPhotoPaths: photoPaths,
      });
      setEditingDetails(false);
      setEditPhotos([]);
      setNotice({kind: 'success', message: 'Task updated.'});
      fireTaskChangeEvent();
      fireActivityChangeEvent(TASK_ENTITY_TYPE, record.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setEditError(e && e.message ? e.message : String(e));
      setEditSaving(false);
    }
  }

  function nameFor(profileId) {
    if (!profileId) return null;
    const p = profiles[profileId];
    return p && p.full_name ? p.full_name : 'Unknown user';
  }

  if (loading) {
    return <RecordPageLoading Header={Header} label="Loading…" />;
  }

  if (loadError) {
    return (
      <RecordPageLoadError
        Header={Header}
        backLabel="Back to Task Center"
        onBack={() => navigate('/tasks')}
        notice={loadError}
        onRetry={loadAll}
        maxWidth={760}
        data-task-instance-load-error="true"
      />
    );
  }

  if (!record) {
    return (
      <RecordPageNotFound
        Header={Header}
        backLabel="Back to Task Center"
        onBack={() => navigate('/tasks')}
        message="Task not found."
      />
    );
  }

  return (
    <RecordPageFrame Header={Header}>
      <RecordPageBody maxWidth={760} data-task-instance-record-loaded="true">
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          <InlineNotice notice={notice} onDismiss={() => setNotice(null)} />

          <RecordBackLink label="Back to Task Center" onBack={() => navigate('/tasks')} />

          <RecordSequenceNav seq={recordSeq} currentId={recordId} onNavigate={navigateSeq} />

          <div style={recordFormCard}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10}}>
              <RecordTitle fontSize={20} margin={0}>
                {record.title}
              </RecordTitle>
              {record.designation === 'recurring' && <span style={BADGE_RECURRING}>Recurring</span>}
              {record.designation === 'system' && <span style={BADGE_SYSTEM}>System</span>}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: 10,
                  background: record.status === 'open' ? '#d1fae5' : '#f3f4f6',
                  color: record.status === 'open' ? '#065f46' : '#374151',
                  textTransform: 'uppercase',
                }}
              >
                {record.status}
              </span>
            </div>

            {editingDetails ? (
              <div data-task-record-edit-panel="1">
                <div className={recordFieldRowClass}>
                  <label htmlFor="task-record-edit-title" style={recordFieldLabel}>
                    Title
                  </label>
                  <input
                    id="task-record-edit-title"
                    data-task-record-edit-field="title"
                    type="text"
                    value={editTitle}
                    maxLength={140}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={recordControl}
                  />
                </div>
                <div className={recordFieldRowClass}>
                  <label htmlFor="task-record-edit-description" style={recordFieldLabel}>
                    Description
                  </label>
                  <textarea
                    id="task-record-edit-description"
                    data-task-record-edit-field="description"
                    value={editDescription}
                    rows={4}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={recordTextarea}
                  />
                </div>
                <div className={recordFieldRowClass}>
                  <label htmlFor="task-record-edit-assignee" style={recordFieldLabel}>
                    Assignee
                  </label>
                  <select
                    id="task-record-edit-assignee"
                    data-task-record-edit-field="assignee"
                    value={editAssigneeId}
                    onChange={(e) => setEditAssigneeId(e.target.value)}
                    style={recordControl}
                  >
                    <option value="">Select</option>
                    {editProfileOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={recordFieldRowClass}>
                  <label htmlFor="task-record-edit-due-date" style={recordFieldLabel}>
                    Due date
                  </label>
                  <input
                    id="task-record-edit-due-date"
                    data-task-record-edit-field="due-date"
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    style={recordControl}
                  />
                </div>
                <div className={recordFieldRowClass}>
                  <span style={recordFieldLabel}>Add request photos</span>
                  <div>
                    {(() => {
                      const counts = taskPhotoCounts(record, recordPhotoRows);
                      const available = Math.max(0, remainingTaskPhotoSlots(counts.total) - editPhotos.length);
                      return (
                        <>
                          <input
                            data-task-record-edit-field="photos"
                            type="file"
                            accept="image/*"
                            multiple
                            disabled={editSaving || available <= 0}
                            onChange={(e) => {
                              addEditPhotos(e.target.files);
                              e.target.value = '';
                            }}
                            style={{fontSize: 13, fontFamily: 'inherit'}}
                          />
                          <div style={{fontSize: 12, color: 'var(--ink-muted)', marginTop: 4}}>
                            {available} of {MAX_TASK_PHOTOS_PER_TASK} photo slots left.
                          </div>
                        </>
                      );
                    })()}
                    {editPhotos.length > 0 && (
                      <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8}}>
                        {editPhotos.map((p, i) => (
                          <span
                            key={i}
                            data-task-record-edit-photo={i}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 12,
                              padding: '4px 8px',
                              background: 'var(--divider)',
                              border: '1px solid var(--border)',
                              borderRadius: 10,
                            }}
                          >
                            {p.name || `Photo ${i + 1}`}
                            <button
                              type="button"
                              aria-label={`Remove photo ${i + 1}`}
                              onClick={() => setEditPhotos(editPhotos.filter((_, j) => j !== i))}
                              disabled={editSaving}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#b91c1c',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: 14,
                              }}
                            >
                              x
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {editError && (
                  <div
                    data-task-record-edit-error="1"
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#991b1b',
                      fontSize: 13,
                    }}
                  >
                    {editError}
                  </div>
                )}
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 12}}>
                  <button
                    type="button"
                    data-task-record-edit-cancel="1"
                    onClick={stopEditDetails}
                    disabled={editSaving}
                    style={recordSecondaryButton}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-task-record-edit-save="1"
                    onClick={saveEditDetails}
                    disabled={editSaving}
                    style={{...recordSaveButton, opacity: editSaving ? 0.7 : 1}}
                  >
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div className={recordFieldRowClass}>
                    <span style={recordFieldLabel}>Due date</span>
                    <span>
                      {fmt(record.due_date)}
                      {(() => {
                        const due = dueStateFor(record, todayCentralISO());
                        if (record.status !== 'open') return null;
                        if (due === 'overdue')
                          return (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#991b1b',
                                background: '#fef2f2',
                                padding: '1px 6px',
                                borderRadius: 999,
                              }}
                            >
                              Overdue
                            </span>
                          );
                        if (due === 'today')
                          return (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#92400e',
                                background: '#fffbeb',
                                padding: '1px 6px',
                                borderRadius: 999,
                              }}
                            >
                              Due today
                            </span>
                          );
                        return null;
                      })()}
                    </span>
                  </div>
                  <div className={recordFieldRowClass}>
                    <span style={recordFieldLabel}>Assigned to</span>
                    <span>{nameFor(record.assignee_profile_id) || 'Unassigned'}</span>
                  </div>
                  {(() => {
                    const attr = attributionFor(record);
                    if (!attr) return null;
                    return (
                      <div className={recordFieldRowClass}>
                        <span style={recordFieldLabel}>{attr.label}</span>
                        <span>{attr.name}</span>
                      </div>
                    );
                  })()}
                </div>

                {record.description && (
                  <div style={{marginTop: 10, fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap'}}>
                    {record.description}
                  </div>
                )}
              </>
            )}

            {record.status === 'completed' && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 10,
                }}
              >
                <div style={{fontSize: 12, fontWeight: 600, color: '#065f46', marginBottom: 4}}>Completed</div>
                <div style={{fontSize: 12, color: '#374151'}}>
                  {fmtCentralDateTime(record.completed_at)}
                  {nameFor(record.completed_by_profile_id) && <> · By {nameFor(record.completed_by_profile_id)}</>}
                </div>
                {record.completion_note && (
                  <div style={{fontSize: 13, color: '#374151', marginTop: 6, whiteSpace: 'pre-wrap'}}>
                    {record.completion_note}
                  </div>
                )}
              </div>
            )}

            {(() => {
              const photo = photoPresenceFor(record);
              const sidecarPaths = new Set((recordPhotoRows || []).map((row) => row && (row.storage_path || row.id)));
              const sidecarCount = Array.from(sidecarPaths).filter(Boolean).length;
              const count = sidecarCount || (photo.hasRequest ? 1 : 0) + (photo.hasCompletion ? 1 : 0);
              if (count <= 0) return null;
              const label = count === 1 ? '1 photo' : count + ' photos';
              return (
                <div style={{marginTop: 10}}>
                  <button
                    type="button"
                    data-task-photo-open="1"
                    onClick={() => setPhotoTarget(record)}
                    title={label}
                    aria-label={label}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 10,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      color: 'var(--ink)',
                    }}
                  >
                    🖼 {label}
                  </button>
                </div>
              );
            })()}

            {record.status === 'open' && (
              <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12}}>
                {canComplete(record) && (
                  <button
                    type="button"
                    data-task-complete-button="1"
                    onClick={() => setCompleteTarget(record)}
                    style={recordSaveButton}
                  >
                    Complete
                  </button>
                )}
                {!editingDetails && canEditDetails(record) && (
                  <button
                    type="button"
                    data-task-edit-details-button="1"
                    onClick={startEditDetails}
                    style={recordSecondaryButton}
                  >
                    Edit
                  </button>
                )}
                {canEditDue(record) && (
                  <button
                    type="button"
                    data-task-edit-due-button="1"
                    onClick={() => setEditDueTarget(record)}
                    style={recordSecondaryButton}
                  >
                    Edit Due
                  </button>
                )}
                {canAssign(record) && (
                  <button
                    type="button"
                    data-task-assign-button="1"
                    onClick={() => setAssignTarget(record)}
                    style={recordSecondaryButton}
                  >
                    Reassign
                  </button>
                )}
                {canDelete(record) && (
                  <button
                    type="button"
                    data-task-delete-button="1"
                    onClick={() => setDeleteTarget(record)}
                    style={recordDeleteButton}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>

          <RecordCollaborationSection
            sb={sb}
            authState={authState}
            entityType="task.instance"
            entityId={record.id}
            entityLabel={record.title}
            spacing={0}
          />

          {React.createElement(CompleteTaskModal, {
            sb,
            authState,
            task: completeTarget,
            isOpen: !!completeTarget,
            onClose: () => setCompleteTarget(null),
            onCompleted: () => {
              setCompleteTarget(null);
              fireTaskChangeEvent();
              setReloadKey((k) => k + 1);
            },
          })}
          {React.createElement(TaskPhotoLightbox, {
            sb,
            task: photoTarget,
            isOpen: !!photoTarget,
            onClose: () => setPhotoTarget(null),
          })}
          {React.createElement(EditDueDateModal, {
            sb,
            task: editDueTarget,
            isOpen: !!editDueTarget,
            isAdmin,
            profilesById: profiles,
            onClose: () => setEditDueTarget(null),
            onUpdated: () => {
              setEditDueTarget(null);
              fireTaskChangeEvent();
              setReloadKey((k) => k + 1);
            },
          })}
          {React.createElement(AssignTaskModal, {
            sb,
            task: assignTarget,
            isOpen: !!assignTarget,
            profilesById: assignableProfiles,
            onClose: () => setAssignTarget(null),
            onAssigned: () => {
              setAssignTarget(null);
              fireTaskChangeEvent();
              setReloadKey((k) => k + 1);
            },
          })}
          {React.createElement(DeleteTaskModal, {
            sb,
            task: deleteTarget,
            isOpen: !!deleteTarget,
            onClose: () => setDeleteTarget(null),
            onDeleted: () => {
              setDeleteTarget(null);
              fireTaskChangeEvent();
              navigate('/tasks');
            },
          })}
        </div>
      </RecordPageBody>
    </RecordPageFrame>
  );
}
