// ============================================================================
// DailysRecentContext — Phase 2.0.5
// ============================================================================
// Thin Provider for the recent-window dailys arrays used by the home dashboard
// and admin-side views. Full histories live elsewhere (LayerContext keeps
// allLayerDailys / allEggDailys; cattle + sheep full histories are fetched on
// demand inside their dedicated views). This context only holds the rolling
// recent-14-day windows that the home dashboard + per-species summary tiles
// consume.
//
//   broilerDailys      : recent poultry_dailys rows
//   pigDailys          : recent pig_dailys rows
//   layerDailysRecent  : recent layer_dailys rows
//   eggDailysRecent    : recent egg_dailys rows
//   cattleDailysRecent : recent cattle_dailys rows
//   sheepDailysRecent  : recent sheep_dailys rows
// ============================================================================
import React, { createContext, useContext, useState } from 'react';

const DailysRecentContext = createContext(null);

export function DailysRecentProvider({ children }) {
  const [broilerDailys,     setBroilerDailys]     = useState([]);
  const [pigDailys,         setPigDailys]         = useState([]);
  const [layerDailysRecent, setLayerDailysRecent] = useState([]);
  const [eggDailysRecent,   setEggDailysRecent]   = useState([]);
  const [cattleDailysRecent,setCattleDailysRecent]= useState([]);
  const [sheepDailysRecent, setSheepDailysRecent] = useState([]);

  const value = {
    broilerDailys,     setBroilerDailys,
    pigDailys,         setPigDailys,
    layerDailysRecent, setLayerDailysRecent,
    eggDailysRecent,   setEggDailysRecent,
    cattleDailysRecent,setCattleDailysRecent,
    sheepDailysRecent, setSheepDailysRecent,
  };
  return <DailysRecentContext.Provider value={value}>{children}</DailysRecentContext.Provider>;
}

export function useDailysRecent() {
  return useContext(DailysRecentContext);
}
