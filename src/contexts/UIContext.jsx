// ============================================================================
// UIContext — Phase 2.0.6 (+ Phase 3.3 pathname-first init)
// ============================================================================
// Thin Provider for global UI state shared across features.
//
//   view              : string — current top-level view (home, broilerHome, etc.)
//                       Initial value reads URL pathname (Phase 3) — the legacy
//                       hash-bookmark branch is defensive backup for the case
//                       where the Phase 3.3 shim somehow didn't run.
//   pendingEdit       : { id, viewName } | null — pops open an edit modal after nav
//   showAllComparison : boolean — broiler comparison-table "show all" toggle
//   showMenu          : boolean — mobile side-menu open
// ============================================================================
import React, { createContext, useContext, useState } from 'react';
import { PATH_TO_VIEW } from '../lib/routes.js';

const UIContext = createContext(null);

function initialView() {
  if (typeof window === 'undefined') return 'home';
  // Primary: pathname. Phase 3.3 shim runs before this useState initializer,
  // so any legacy hash bookmarks have already been rewritten to clean paths.
  const pathView = PATH_TO_VIEW[window.location.pathname];
  if (pathView) return pathView;
  // Defensive backup: hash (should never fire after 3.3 in normal flow,
  // but if the shim threw for some reason we still honor the bookmark).
  const h = window.location.hash;
  if (h === '#webforms' || h === '#/webforms') return 'webformhub';
  if (h === '#addfeed'  || h === '#/addfeed')  return 'addfeed';
  if (h === '#weighins' || h === '#/weighins') return 'weighins';
  if (h === '#pigdailys'|| h === '#/pigdailys')return 'webform';
  return 'home';
}

export function UIProvider({ children }) {
  const [view,              setView]              = useState(initialView);
  const [pendingEdit,       setPendingEdit]       = useState(null);
  const [showAllComparison, setShowAllComparison] = useState(false);
  const [showMenu,          setShowMenu]          = useState(false);

  const value = {
    view,              setView,
    pendingEdit,       setPendingEdit,
    showAllComparison, setShowAllComparison,
    showMenu,          setShowMenu,
  };
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  return useContext(UIContext);
}
