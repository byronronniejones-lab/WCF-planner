// Task Center — Completed tab. Placeholder in T2 of Tasks v2; the
// completed-tasks list (with completion notes, completion photos,
// and completer attribution) lands in a later commit.
//
// JSX-only file: relies on Vite's automatic JSX runtime so no
// `import React` is needed.

export default function CompletedTab() {
  return (
    <div data-tasks-tab="completed">
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
        Completed tasks will appear here in a later release.
      </div>
    </div>
  );
}
