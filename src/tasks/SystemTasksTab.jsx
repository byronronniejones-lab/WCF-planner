// Task Center — System Tasks tab. Admin-only. Placeholder in T2 of
// Tasks v2; lands functional in a later commit (admin CRUD on
// task_system_rules, lead-time edits, and a list of designation='system'
// instances).
//
// Tab visibility is gated in TaskCenterView; reaching this component
// already means the caller is admin. We still render a defensive
// admin-only message in case a future code path mounts it incorrectly.
//
// JSX-only file: relies on Vite's automatic JSX runtime so no
// `import React` is needed.

export default function SystemTasksTab() {
  return (
    <div data-tasks-tab="system">
      <div
        style={{
          background: 'white',
          borderRadius: 10,
          padding: '14px 16px',
          border: '1px solid #e5e7eb',
          color: '#6b7280',
          fontSize: 13,
        }}
      >
        System tasks (admin only). Built-in rules — broiler weigh-ins, clean brooder, pig 6-month — will be editable
        here in a later release.
      </div>
    </div>
  );
}
