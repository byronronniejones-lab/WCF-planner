// ============================================================================
// FeedCostsContext — Phase 2.0.6
// ============================================================================
// Thin Provider for feed-cost + missed-report clearing state.
//
//   feedCosts     : { starter, grower, layer, pig, grit } — $/lb
//   missedCleared : Set — cleared missed-report keys
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

const FeedCostsContext = createContext(null);

export function FeedCostsProvider({children}) {
  const [feedCosts, setFeedCosts] = useState({
    starter: 0,
    grower: 0,
    layer: 0,
    pig: 0,
    grit: 0,
  });
  const [missedCleared, setMissedCleared] = useState(new Set());

  const value = {
    feedCosts,
    setFeedCosts,
    missedCleared,
    setMissedCleared,
  };
  return <FeedCostsContext.Provider value={value}>{children}</FeedCostsContext.Provider>;
}

export function useFeedCosts() {
  return useContext(FeedCostsContext);
}
