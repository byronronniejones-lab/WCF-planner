// ============================================================================
// AuthContext — Phase 2.0.1
// ============================================================================
// Thin Provider that owns the auth-related useState hooks previously declared
// at the top of App(). All effects (auth listener, visibility refresh,
// access-gate redirect), helpers (loadUser, loadAllData, canAccessProgram),
// and derived values (role, isAdmin, canEditAll, etc.) remain in App.jsx —
// they read state via useAuth() and call the setters exposed here.
//
// The shape of the state is unchanged from the pre-migration version:
//   authState   : null (loading) | false (signed out) | { user, role, profile, name }
//   pwRecovery  : boolean — true when URL hash indicates recovery/invite link
//   dataLoaded  : boolean — false until loadAllData() resolves
//   saveStatus  : '' | 'saving' | 'saved' | 'error'
//   showUsers, allUsers, inviteEmail, inviteRole, inviteMsg — UsersModal state
// ============================================================================
import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

const AuthContext = createContext(null);
export const ROLE_PREVIEW_ROLES = ['admin', 'management', 'farm_team', 'equipment_tech', 'light', 'inactive'];

function withRolePreview(authState, rolePreview) {
  if (!authState || authState === false || !rolePreview || !ROLE_PREVIEW_ROLES.includes(rolePreview)) return authState;
  return {
    ...authState,
    role: rolePreview,
    // Diagnostic markers only: consumers can identify preview state without
    // touching Supabase auth, the JWT, or the stored profile row.
    rolePreviewActive: true,
    realRole: authState.role,
    profile:
      authState.profile && typeof authState.profile === 'object'
        ? {...authState.profile, role: rolePreview}
        : authState.profile,
  };
}

export function AuthProvider({children}) {
  const [realAuthState, setAuthState] = useState(null);
  const [rolePreview, setRolePreviewRaw] = useState('');
  const [pwRecovery, setPwRecovery] = useState(() => {
    if (typeof window === 'undefined') return false;
    const h = window.location.hash || '';
    const q = window.location.search || '';
    return (
      /[#&?]type=recovery\b/.test(h) ||
      /[?&]type=recovery\b/.test(q) ||
      /[#&?]type=invite\b/.test(h) ||
      /[?&]type=invite\b/.test(q)
    );
  });
  const [dataLoaded, setDataLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [showUsers, setShowUsers] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('farm_team');
  const [inviteMsg, setInviteMsg] = useState('');

  const canUseRolePreview = !!(realAuthState && realAuthState !== false && realAuthState.role === 'admin');
  useEffect(() => {
    if (!canUseRolePreview && rolePreview) setRolePreviewRaw('');
  }, [canUseRolePreview, rolePreview]);

  const setRolePreview = useCallback((nextRole) => {
    setRolePreviewRaw(ROLE_PREVIEW_ROLES.includes(nextRole) ? nextRole : '');
  }, []);
  const clearRolePreview = useCallback(() => setRolePreviewRaw(''), []);
  const activeRolePreview = canUseRolePreview ? rolePreview : '';
  const authState = useMemo(
    () => (activeRolePreview ? withRolePreview(realAuthState, activeRolePreview) : realAuthState),
    [realAuthState, activeRolePreview],
  );

  const value = {
    authState,
    realAuthState,
    setAuthState,
    rolePreview: activeRolePreview,
    setRolePreview,
    clearRolePreview,
    rolePreviewRoles: ROLE_PREVIEW_ROLES,
    canUseRolePreview,
    pwRecovery,
    setPwRecovery,
    dataLoaded,
    setDataLoaded,
    saveStatus,
    setSaveStatus,
    showUsers,
    setShowUsers,
    allUsers,
    setAllUsers,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviteMsg,
    setInviteMsg,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
