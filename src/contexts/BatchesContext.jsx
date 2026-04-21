// ============================================================================
// BatchesContext — Phase 2.0.2
// ============================================================================
// Thin Provider that owns the broiler batch + broiler-edit-form useState hooks
// previously declared at the top of App(). Helpers and derived values remain
// in App.jsx; this module just holds the state.
//
//   batches         : broiler batches array (hydrated by loadAllData)
//   showForm        : boolean — broiler add/edit modal open
//   editId          : string|null — id of batch being edited
//   form            : object — current batch form state (defaults to EMPTY_FORM)
//   originalForm    : snapshot of form at edit-open time (for dirty detection)
//   conflicts       : array — scheduling conflicts detected by detectConflicts()
//   tlStart         : ISO date — broiler timeline view start
//   tooltip         : { id, x, y } | null — timeline hover tooltip
//   override        : boolean — manual override of schedule conflict warning
//   showLegacy      : boolean — legacy hatchery/breed dropdowns toggle
//   parsedProcessor : { avgDressed, avgBreast, avgThigh, birdCount, fileName } | null
//   docUploading    : boolean — batch-document upload in flight
//   deleteConfirm   : { message, onConfirm } | null — shared delete modal state
//
// `thisMonday` is the tlStart initializer; App.jsx still defines it (it's a
// module-scope const). We read it via the `tlStartInit` prop so BatchesContext
// has zero compile-time dependency on the date helpers.
//
// EMPTY_FORM is module-scope in main.jsx — passed in as `formInit` so this
// file doesn't need to import it.
// ============================================================================
import React, { createContext, useContext, useState } from 'react';

const BatchesContext = createContext(null);

export function BatchesProvider({ children, formInit, tlStartInit }) {
  const [batches,         setBatches]         = useState([]);
  const [showForm,        setShowForm]        = useState(false);
  const [editId,          setEditId]          = useState(null);
  const [form,            setForm]            = useState(formInit);
  const [originalForm,    setOriginalForm]    = useState(null);
  const [conflicts,       setConflicts]       = useState([]);
  const [tlStart,         setTlStart]         = useState(tlStartInit);
  const [tooltip,         setTooltip]         = useState(null);
  const [override,        setOverride]        = useState(false);
  const [showLegacy,      setShowLegacy]      = useState(false);
  const [parsedProcessor, setParsedProcessor] = useState(null);
  const [docUploading,    setDocUploading]    = useState(false);
  const [deleteConfirm,   setDeleteConfirm]   = useState(null);

  const value = {
    batches,         setBatches,
    showForm,        setShowForm,
    editId,          setEditId,
    form,            setForm,
    originalForm,    setOriginalForm,
    conflicts,       setConflicts,
    tlStart,         setTlStart,
    tooltip,         setTooltip,
    override,        setOverride,
    showLegacy,      setShowLegacy,
    parsedProcessor, setParsedProcessor,
    docUploading,    setDocUploading,
    deleteConfirm,   setDeleteConfirm,
  };
  return <BatchesContext.Provider value={value}>{children}</BatchesContext.Provider>;
}

export function useBatches() {
  return useContext(BatchesContext);
}
