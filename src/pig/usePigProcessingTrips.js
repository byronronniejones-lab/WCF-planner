import {useState, useEffect} from 'react';
import {sb} from '../lib/supabase.js';
import {computePigBatchFCR, pigSourceCountKeys} from '../lib/pig.js';

// Pig.batch processing-trip workflow (CP10 extraction from PigBatchesView).
// Owns the trip-source tracking state (weigh_ins.sent_to_trip_id ->
// weigh_in_sessions.batch_id) and the add/edit/close/delete handlers. Verbatim
// lift — processingTrips add/edit/delete behavior, the existing-trip spread that
// preserves subAttributions + ad-hoc fields, numeric coercion (pigCount /
// hangingWeight), the date-required guard, date sort, autosave debounce, close
// flush, delete confirmation, and the fcrCached stamp/clear contract via
// computePigBatchFCR are all unchanged.
//
// The processing-trip FORM state stays owned by PigContext and is threaded in
// (activeTripBatchId/tripForm/editTripId + setters). Other deps explicit:
//   feederGroups / persistFeeders — ppp-feeders-v1 source of truth + persist
//   confirmDelete                 — delete-confirmation helper
//   tripAutoSaveTimer             — shared debounce ref (prop)
//   breeders / dailysForName      — inputs to computePigBatchFCR
export function usePigProcessingTrips({
  feederGroups,
  persistFeeders,
  confirmDelete,
  tripAutoSaveTimer,
  breeders,
  dailysForName,
  activeTripBatchId,
  setActiveTripBatchId,
  tripForm,
  setTripForm,
  editTripId,
  setEditTripId,
}) {
  // Trip source tracking: for each processing trip, which weigh-in session(s)
  // contributed pigs. Pulled from weigh_ins (sent_to_trip_id) + sessions (batch_id).
  const [tripSentWeighins, setTripSentWeighins] = useState([]);
  const [tripSessionBatch, setTripSessionBatch] = useState({}); // session_id -> batch_id
  useEffect(() => {
    (async () => {
      const {data: sent} = await sb
        .from('weigh_ins')
        .select('id, session_id, sent_to_trip_id, weight')
        .not('sent_to_trip_id', 'is', null);
      if (!sent) return;
      setTripSentWeighins(sent);
      const ids = [...new Set(sent.map((e) => e.session_id).filter(Boolean))];
      if (ids.length === 0) return;
      const {data: sess} = await sb.from('weigh_in_sessions').select('id, batch_id').in('id', ids);
      const m = {};
      (sess || []).forEach((s) => {
        m[s.id] = s.batch_id;
      });
      setTripSessionBatch(m);
    })();
  }, []);
  function tripSourceEntries(tripId) {
    if (!tripId) return [];
    return tripSentWeighins
      .filter((e) => e.sent_to_trip_id === tripId)
      .slice()
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  }
  function tripSourceWeights(tripId) {
    return tripSourceEntries(tripId)
      .map((e) => parseFloat(e.weight) || 0)
      .filter((w) => w > 0);
  }
  function tripSourceCounts(tripId) {
    const counts = {};
    tripSourceEntries(tripId).forEach((e) => {
      const name = tripSessionBatch[e.session_id] || 'Unknown session';
      counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
  }
  function tripSourceCountsByKey(tripId) {
    const counts = {};
    tripSourceEntries(tripId).forEach((e) => {
      const name = tripSessionBatch[e.session_id] || 'Unknown session';
      pigSourceCountKeys(name).forEach((key) => {
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }
  function tripSourceSummary(tripId) {
    const weights = tripSourceWeights(tripId);
    const totalLive = weights.reduce((a, b) => a + b, 0);
    const avgLive = weights.length > 0 ? totalLive / weights.length : null;
    return {
      weights,
      count: weights.length,
      totalLive,
      avgLive,
      counts: tripSourceCounts(tripId),
      countsByKey: tripSourceCountsByKey(tripId),
    };
  }

  function persistTrip(batchId, formSnapshot, currentTripId) {
    if (!formSnapshot.date) return;
    const sourceWeights = tripSourceWeights(currentTripId);
    // Processing trips are actual processor events sourced from sent weigh-in
    // entries. Do not create a NEW processing trip unless it has stamped
    // weigh_in rows. Legacy existing trips can still be edited with their
    // stored pigCount/liveWeights until a source backfill links them.
    if (!currentTripId) return;
    const hasLinkedSource = sourceWeights.length > 0;
    const tripFormBase = {...formSnapshot};
    ['hangingWeight'].forEach((key) => {
      const v = tripFormBase[key];
      tripFormBase[key] = v === '' || v == null ? 0 : parseFloat(v) || 0;
    });
    const tripId = currentTripId || String(Date.now());
    const nb = feederGroups.map((g) => {
      if (g.id !== batchId) return g;
      const trips = g.processingTrips || [];
      // Preserve fields not present in the form (subAttributions, any
      // future ad-hoc keys) by spreading the existing trip first when
      // editing. Same shape rule as persistSubBatch.
      const existing = currentTripId ? trips.find((t) => t.id === currentTripId) || {} : {};
      const tripFormNum = {
        ...tripFormBase,
        pigCount: hasLinkedSource ? sourceWeights.length : parseInt(existing.pigCount ?? tripFormBase.pigCount) || 0,
        liveWeights: hasLinkedSource ? sourceWeights.join(' ') : existing.liveWeights || tripFormBase.liveWeights || '',
      };
      const trip = {...existing, ...tripFormNum, id: tripId};
      const updated = currentTripId ? trips.map((t) => (t.id === currentTripId ? trip : t)) : [...trips, trip];
      updated.sort((a, b) => a.date.localeCompare(b.date));
      const next = {...g, processingTrips: updated};
      // Stamp parent.fcrCached so Transfer-to-Breeding (which reads it
      // from the persisted record) gets the real adjusted-feed / total-
      // live-weight ratio instead of falling back to the 3.5 industry
      // default. Recomputed here on every trip add/edit because the
      // numerator (raw feed) and denominator (trip live wt) both change
      // when trips change. If the helper returns null (no valid trips
      // remaining, or rawFeed <= credits), CLEAR the cache so the transfer
      // flow falls back to the default rather than using a stale ratio.
      const fcr = computePigBatchFCR(next, dailysForName, breeders, {tripSourceSummary});
      if (fcr != null) next.fcrCached = fcr;
      else delete next.fcrCached;
      return next;
    });
    persistFeeders(nb);
    if (!editTripId) setEditTripId(tripId);
    return tripId;
  }
  function updTrip(k, v) {
    const next = {...tripForm, [k]: v};
    setTripForm(next);
    if (!next.date) return;
    clearTimeout(tripAutoSaveTimer.current);
    tripAutoSaveTimer.current = setTimeout(() => {
      persistTrip(activeTripBatchId, next, editTripId);
    }, 1500);
  }
  function closeTripForm() {
    clearTimeout(tripAutoSaveTimer.current);
    if (tripForm.date && activeTripBatchId) {
      persistTrip(activeTripBatchId, tripForm, editTripId);
    }
    setTripForm({date: '', pigCount: 0, liveWeights: '', hangingWeight: 0, notes: ''});
    setEditTripId(null);
    setActiveTripBatchId(null);
  }

  function deleteTrip(batchId, tripId) {
    confirmDelete('Delete this processing trip? This cannot be undone.', () => {
      const nb = feederGroups.map((g) => {
        if (g.id !== batchId) return g;
        const next = {...g, processingTrips: (g.processingTrips || []).filter((t) => t.id !== tripId)};
        // Recompute fcrCached after the trip's live weight is removed.
        // If no valid trips remain, CLEAR the cache so the transfer flow
        // falls back to the 3.5 industry default rather than driving
        // future allocations off a stale ratio.
        const fcr = computePigBatchFCR(next, dailysForName, breeders, {tripSourceSummary});
        if (fcr != null) next.fcrCached = fcr;
        else delete next.fcrCached;
        return next;
      });
      persistFeeders(nb);
    });
  }

  return {
    tripSourceCounts,
    tripSourceEntries,
    tripSourceWeights,
    tripSourceSummary,
    updTrip,
    closeTripForm,
    deleteTrip,
  };
}
