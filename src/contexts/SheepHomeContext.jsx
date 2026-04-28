// ============================================================================
// SheepHomeContext — Phase 2.0.6
// ============================================================================
// Thin Provider for the sheep summary state surfaced on the home dashboard.
//
//   sheepForHome : [{id, flock}] directory for missed-report flock-presence check
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

const SheepHomeContext = createContext(null);

export function SheepHomeProvider({children}) {
  const [sheepForHome, setSheepForHome] = useState([]);

  const value = {sheepForHome, setSheepForHome};
  return <SheepHomeContext.Provider value={value}>{children}</SheepHomeContext.Provider>;
}

export function useSheepHome() {
  return useContext(SheepHomeContext);
}
