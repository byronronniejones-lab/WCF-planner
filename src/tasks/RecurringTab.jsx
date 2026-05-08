// Task Center — Recurring tab. Placeholder in T2 of Tasks v2; lands
// functional in a later commit (admin recurring-template CRUD + the
// designation='recurring' instances list).
//
// JSX-only file: relies on Vite's automatic JSX runtime
// (@vitejs/plugin-react default), so no `import React` is needed.

export default function RecurringTab() {
  return (
    <div data-tasks-tab="recurring">
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
        Recurring templates and their generated task instances will appear here in a later release.
      </div>
    </div>
  );
}
