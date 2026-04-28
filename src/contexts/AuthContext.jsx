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
import React, {createContext, useContext, useState} from 'react';

const AuthContext = createContext(null);

export function AuthProvider({children}) {
  const [authState, setAuthState] = useState(null);
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

  const value = {
    authState,
    setAuthState,
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
