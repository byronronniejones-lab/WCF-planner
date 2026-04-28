// ============================================================================
// LayerContext — Phase 2.0.4
// ============================================================================
// Thin Provider for layer-scoped useState hooks. Loaders + helpers stay in
// App.jsx; this module just holds the state.
//
//   layerGroups       : legacy layer groups array (ppp-layer-groups-v1)
//   layerBatches      : rows from layer_batches table
//   layerHousings     : rows from layer_housings table
//   allLayerDailys    : full layer_dailys history for dashboard windowing
//   allEggDailys      : full egg_dailys history
//   layerDashPeriod   : 30 | 90 | 120 — layer home dashboard rolling window
//   retHomeDashPeriod : 30 | 90 | 120 — layer returns/eggs window toggle
// ============================================================================
import React, {createContext, useContext, useState} from 'react';

const LayerContext = createContext(null);

export function LayerProvider({children}) {
  const [layerGroups, setLayerGroups] = useState([]);
  const [layerBatches, setLayerBatches] = useState([]);
  const [layerHousings, setLayerHousings] = useState([]);
  const [allLayerDailys, setAllLayerDailys] = useState([]);
  const [allEggDailys, setAllEggDailys] = useState([]);
  const [layerDashPeriod, setLayerDashPeriod] = useState(30);
  const [retHomeDashPeriod, setRetHomeDashPeriod] = useState(30);

  const value = {
    layerGroups,
    setLayerGroups,
    layerBatches,
    setLayerBatches,
    layerHousings,
    setLayerHousings,
    allLayerDailys,
    setAllLayerDailys,
    allEggDailys,
    setAllEggDailys,
    layerDashPeriod,
    setLayerDashPeriod,
    retHomeDashPeriod,
    setRetHomeDashPeriod,
  };
  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>;
}

export function useLayer() {
  return useContext(LayerContext);
}
