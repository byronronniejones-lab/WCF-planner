// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import React from 'react';

// ============================================================================
// InlineNotice — small inline error/warning banner used in place of alert()
// ============================================================================
// Drop in next to a form action area (inside a modal) or above a list view
// (after a filter row). Renders nothing when `notice` is null. Caller owns
// the state so the same notice object can be rendered in two places (e.g.
// inside an open modal AND on the list view behind it) and dismissed once.
//
// Shape:
//   notice = { kind: 'error' | 'warning', message: string } | null
//
// `kind` defaults to 'error'. Multi-line messages are honored via
// white-space: pre-line on the body text.
// ============================================================================

export default function InlineNotice({notice, onDismiss}) {
  if (!notice || !notice.message) return null;
  const kind = notice.kind === 'warning' ? 'warning' : 'error';
  const palette =
    kind === 'warning'
      ? {bg: '#fef3c7', border: '#fde68a', fg: '#92400e'}
      : {bg: '#fee2e2', border: '#fecaca', fg: '#b91c1c'};
  return (
    <div
      role="alert"
      data-inline-notice={kind}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{flex: 1, whiteSpace: 'pre-line', minWidth: 0, wordBreak: 'break-word'}}>{notice.message}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          style={{
            background: 'none',
            border: 'none',
            color: palette.fg,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            marginTop: 2,
            fontFamily: 'inherit',
          }}
        >
          {'×'}
        </button>
      )}
    </div>
  );
}
