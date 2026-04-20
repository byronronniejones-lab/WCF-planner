// ============================================================================
// FeedCostsContext — Phase 2.0.6
// ============================================================================
// Thin Provider for feed-cost + broiler notes + missed-report clearing state.
// Other feed-related UI state (feed orders, inventories, expanded-month sets,
// pig/layer notes, adminTab) stays in App.jsx for now — only the three fields
// the plan names for this context are moved.
//
//   feedCosts     : { starter, grower, layer, pig, grit } — $/lb
//   broilerNotes  : free-text broiler dashboard notes
//   missedCleared : Set — cleared missed-report keys
// ============================================================================
import React, { createContext, useContext, useState } from 'react';

const FeedCostsContext = createContext(null);

export function FeedCostsProvider({ children }) {
  const [feedCosts,     setFeedCosts]     = useState({
    starter: 0, grower: 0, layer: 0, pig: 0, grit: 0,
  });
  const [broilerNotes,  setBroilerNotes]  = useState('');
  const [missedCleared, setMissedCleared] = useState(new Set());

  const value = {
    feedCosts,     setFeedCosts,
    broilerNotes,  setBroilerNotes,
    missedCleared, setMissedCleared,
  };
  return <FeedCostsContext.Provider value={value}>{children}</FeedCostsContext.Provider>;
}

export function useFeedCosts() {
  return useContext(FeedCostsContext);
}
