// ============================================================================
// UIContext — Phase 2.0.6
// ============================================================================
// Thin Provider for global UI state shared across features.
//
//   view              : string — current top-level view (home, broilerHome, etc.)
//                       Initial value reads URL hash for webform bookmarks.
//   pendingEdit       : { id, viewName } | null — pops open an edit modal after nav
//   showAllComparison : boolean — broiler comparison-table "show all" toggle
//   showMenu          : boolean — mobile side-menu open
// ============================================================================
import React, { createContext, useContext, useState } from 'react';

const UIContext = createContext(null);

function initialView() {
  if (typeof window === 'undefined') return 'home';
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
