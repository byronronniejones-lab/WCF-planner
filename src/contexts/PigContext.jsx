// ============================================================================
// PigContext — Phase 2.0.3
// ============================================================================
// Thin Provider that owns all pig-scoped useState hooks from App(). Helpers
// (submit, archive, edit openers, etc.) and the auto-save effects still live
// in App.jsx and will move to a pig feature folder in Phase 2 Round 6.
//
// External constants that feed initial state (INITIAL_FARROWING,
// INITIAL_BREEDERS, the breedTlStart computation) are module-scope in
// main.jsx. We accept them as props so this file has no upstream dep on the
// monolith — the root render reads them from the module scope that already
// defines them and threads them in.
//
// State owned:
//   pigData            : { sows, nursingSows, boars, feederGroups:[{id,count,ageMonths}] }
//   breedingCycles     : array of breeding cycles
//   farrowingRecs      : array of farrowing records
//   boarNames          : { boar1, boar2 }
//   breedTlStart       : ISO date — breeding timeline view start
//   feederGroups       : array — pig feeder group / batch records
//   breeders           : array — sow/boar registry
//   breedOptions       : string[] — breed dropdown options
//   originOptions      : string[] — origin dropdown options
//   archivedSows       : array — archived sow records
//
//   Breeding form: showBreedForm, editBreedId, breedForm
//   Farrowing form: showFarrowForm, editFarrowId, farrowForm, farrowFilter
//   Feeder form:   showFeederForm, editFeederId, feederForm, originalFeederForm
//   Sows UI:       sowSearch, expandedSow
//   Breeder form:  showBreederForm, editBreederId, breederForm
//   Trip form:     activeTripBatchId, tripForm, editTripId
// ============================================================================
import React, { createContext, useContext, useState } from 'react';

const PigContext = createContext(null);

const DEFAULT_PIG_DATA = {
  sows: 0, nursingSows: 0, boars: 0,
  feederGroups: [{ id: "1", count: 0, ageMonths: 1 }],
};

const EMPTY_BREED_FORM = {
  group: "1", boar1Tags: "", boar2Tags: "", exposureStart: "", notes: "",
};

const EMPTY_FARROW_FORM = {
  sow: "", group: "1", farrowingDate: "",
  exposureStart: "", exposureEnd: "", sire: "",
  motheringQuality: "", demeanor: "",
  totalBorn: 0, deaths: 0, location: "",
  wentWell: "", didntGoWell: "", defects: "",
};

const EMPTY_FEEDER_FORM = {
  batchName: "", cycleId: "", giltCount: 0, boarCount: 0,
  startDate: "", originalPigCount: 0, perLbFeedCost: 0,
  legacyFeedLbs: 0, notes: "", status: "active",
};

const EMPTY_TRIP_FORM = {
  date: "", pigCount: 0, liveWeights: "", hangingWeight: 0, notes: "",
};

const EMPTY_BREEDER_FORM = {
  tag: "", sex: "Sow", group: "1", status: "Sow Group",
  breed: "", origin: "",
  birthDate: "", lastWeight: "", purchaseDate: "", purchaseAmount: "",
};

const DEFAULT_BOAR_NAMES = { boar1: "MACHINE", boar2: "AO" };

export function PigProvider({
  children,
  initialFarrowing,
  initialBreeders,
  breedTlStartInit,
}) {
  const [pigData, setPigData] = useState(() => {
    try {
      const r = localStorage.getItem("ppp-pigs-v1");
      return r ? JSON.parse(r) : DEFAULT_PIG_DATA;
    } catch (e) {
      return DEFAULT_PIG_DATA;
    }
  });
  const [breedingCycles, setBreedingCycles] = useState(() => {
    try {
      const r = localStorage.getItem("ppp-breeding-v1");
      return r ? JSON.parse(r) : [];
    } catch (e) {
      return [];
    }
  });
  const [farrowingRecs, setFarrowingRecs] = useState(() => {
    try {
      const r = localStorage.getItem("ppp-farrowing-v1");
      return r ? JSON.parse(r) : initialFarrowing;
    } catch (e) {
      return initialFarrowing;
    }
  });
  const [boarNames, setBoarNames] = useState(() => {
    try {
      const r = localStorage.getItem("ppp-boars-v1");
      return r ? JSON.parse(r) : DEFAULT_BOAR_NAMES;
    } catch (e) {
      return DEFAULT_BOAR_NAMES;
    }
  });
  const [breedTlStart, setBreedTlStart] = useState(breedTlStartInit);

  // Breeding form
  const [showBreedForm, setShowBreedForm] = useState(false);
  const [editBreedId,   setEditBreedId]   = useState(null);
  const [breedForm,     setBreedForm]     = useState(EMPTY_BREED_FORM);

  // Farrowing form
  const [showFarrowForm, setShowFarrowForm] = useState(false);
  const [editFarrowId,   setEditFarrowId]   = useState(null);
  const [farrowForm,     setFarrowForm]     = useState(EMPTY_FARROW_FORM);
  const [farrowFilter,   setFarrowFilter]   = useState({ group: "all", sow: "" });

  // Feeder groups + form
  const [feederGroups, setFeederGroups] = useState(() => {
    try {
      const r = localStorage.getItem("ppp-feeders-v1");
      return r ? JSON.parse(r) : [];
    } catch (e) {
      return [];
    }
  });
  const [showFeederForm,     setShowFeederForm]     = useState(false);
  const [editFeederId,       setEditFeederId]       = useState(null);
  const [feederForm,         setFeederForm]         = useState(EMPTY_FEEDER_FORM);
  const [originalFeederForm, setOriginalFeederForm] = useState(null);

  // Trip form
  const [activeTripBatchId, setActiveTripBatchId] = useState(null);
  const [tripForm,          setTripForm]          = useState(EMPTY_TRIP_FORM);
  const [editTripId,        setEditTripId]        = useState(null);

  // Sows UI
  const [sowSearch,    setSowSearch]    = useState("");
  const [expandedSow,  setExpandedSow]  = useState(null);
  const [archivedSows, setArchivedSows] = useState([]);
  const [breeders,     setBreeders]     = useState(initialBreeders);
  const [breedOptions, setBreedOptions] = useState([
    "Berkshire", "Duroc", "Berkshire Cross", "Duroc/Berkshire Cross",
  ]);
  const [originOptions, setOriginOptions] = useState([
    "Born on Farm", "Corey Davis",
  ]);
  const [showBreederForm, setShowBreederForm] = useState(false);
  const [editBreederId,   setEditBreederId]   = useState(null);
  const [breederForm,     setBreederForm]     = useState(EMPTY_BREEDER_FORM);

  const value = {
    pigData, setPigData,
    breedingCycles, setBreedingCycles,
    farrowingRecs, setFarrowingRecs,
    boarNames, setBoarNames,
    breedTlStart, setBreedTlStart,
    showBreedForm, setShowBreedForm,
    editBreedId, setEditBreedId,
    breedForm, setBreedForm,
    showFarrowForm, setShowFarrowForm,
    editFarrowId, setEditFarrowId,
    farrowForm, setFarrowForm,
    farrowFilter, setFarrowFilter,
    feederGroups, setFeederGroups,
    showFeederForm, setShowFeederForm,
    editFeederId, setEditFeederId,
    feederForm, setFeederForm,
    originalFeederForm, setOriginalFeederForm,
    activeTripBatchId, setActiveTripBatchId,
    tripForm, setTripForm,
    editTripId, setEditTripId,
    sowSearch, setSowSearch,
    expandedSow, setExpandedSow,
    archivedSows, setArchivedSows,
    breeders, setBreeders,
    breedOptions, setBreedOptions,
    originOptions, setOriginOptions,
    showBreederForm, setShowBreederForm,
    editBreederId, setEditBreederId,
    breederForm, setBreederForm,
  };
  return <PigContext.Provider value={value}>{children}</PigContext.Provider>;
}

export function usePig() {
  return useContext(PigContext);
}
