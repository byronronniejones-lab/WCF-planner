import React from 'react';

// Component-level guard that redirects non-admin (or non-authenticated) users
// off a sensitive route to a fallback view. Used by AdminTasksView so that a
// non-admin who pastes /admin/tasks into the URL bar doesn't see admin UI
// even momentarily — the Header dropdown gating alone is not enough.
//
// authState shape (from AuthContext):
//   null             — still loading; render nothing, do not redirect.
//   false            — signed out; redirect to fallback (LoginScreen renders
//                      from there).
//   {user, role, ...}— authenticated; allow if role === 'admin' (when
//                      requireAdmin) or always (when requireAdmin=false).
//
// Redirect uses setView() — the same setter every other view-switch in the
// app uses — so back/forward + URL sync stays consistent with the rest of
// the router.
export default function UnauthorizedRedirect({
  authState,
  setView,
  requireAdmin = true,
  fallbackView = 'home',
  children,
}) {
  const allowed = isAllowed(authState, requireAdmin);

  React.useEffect(() => {
    if (authState === null) return; // still loading — wait
    if (!allowed) {
      setView(fallbackView);
    }
  }, [authState, allowed, setView, fallbackView]);

  if (authState === null) return null; // loading — render nothing
  if (!allowed) return null; // redirecting — render nothing
  return <>{children}</>;
}

function isAllowed(authState, requireAdmin) {
  if (authState === null) return false;
  if (authState === false) return false;
  if (!authState || typeof authState !== 'object') return false;
  if (requireAdmin && authState.role !== 'admin') return false;
  return true;
}
