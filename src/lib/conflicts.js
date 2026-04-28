// Schedule-conflict detection for broiler batches vs both other broiler
// batches (hard conflict) and active layer batches in the same brooder/
// schooner slots (soft conflict). Lifted verbatim from main.jsx — the
// \u2013 escape literals are deliberate (§10 don't-touch list).

import {addDays, toISO, fmtS} from './dateUtils.js';
import {calcTimeline, overlaps, BROODER_CLEANOUT, SCHOONER_CLEANOUT} from './broiler.js';

export function detectConflicts(form, batches, layerBatches, editId) {
  const tl = calcTimeline(form.hatchDate, form.breed, form.processingDate);
  if (!tl) return [];
  const safeAddDays = (dateStr, n) => {
    if (!dateStr) return null;
    try {
      return toISO(addDays(dateStr, n));
    } catch (e) {
      return null;
    }
  };
  const bEnd = safeAddDays(tl.brooderOut, BROODER_CLEANOUT);
  const sEnd = safeAddDays(tl.schoonerOut, SCHOONER_CLEANOUT);
  if (!bEnd && !sEnd) return [];
  const out = [];
  // Hard conflicts: broiler vs broiler
  for (const b of batches) {
    if (b.id === editId) continue;
    if (b.brooder === form.brooder && b.brooderIn && b.brooderOut && bEnd) {
      const exEnd = safeAddDays(b.brooderOut, BROODER_CLEANOUT);
      if (exEnd && overlaps(tl.brooderIn, bEnd, b.brooderIn, exEnd))
        out.push({
          soft: false,
          message:
            'Brooder ' +
            form.brooder +
            ' conflict with "' +
            b.name +
            '" (brooder ' +
            fmtS(b.brooderIn) +
            '\u2013' +
            fmtS(b.brooderOut) +
            ' + ' +
            BROODER_CLEANOUT +
            'd cleanout)',
        });
    }
    if (b.schooner === form.schooner && b.schoonerIn && b.schoonerOut && sEnd) {
      const exEnd = safeAddDays(b.schoonerOut, SCHOONER_CLEANOUT);
      if (exEnd && overlaps(tl.schoonerIn, sEnd, b.schoonerIn, exEnd))
        out.push({
          soft: false,
          message:
            'Schooner ' +
            form.schooner +
            ' conflict with "' +
            b.name +
            '" (schooner ' +
            fmtS(b.schoonerIn) +
            '\u2013' +
            fmtS(b.schoonerOut) +
            ' + ' +
            SCHOONER_CLEANOUT +
            'd cleanout)',
        });
    }
  }
  // Soft conflicts: broiler vs layer (layer brooder/schooner names have prefix to strip)
  if (layerBatches && layerBatches.length) {
    for (const lb of layerBatches) {
      if (lb.status === 'retired') continue;
      if (lb.name === 'Retirement Home') continue;
      // Strip "Brooder " / "Schooner " prefix to compare with broiler form values
      const lbBrooderId = (lb.brooder_name || '').replace(/^Brooder\s*/i, '').trim();
      const lbSchoonerId = (lb.schooner_name || '').replace(/^Schooner\s*/i, '').trim();
      // Brooder check
      if (lbBrooderId && lbBrooderId === form.brooder && lb.brooder_entry_date && bEnd) {
        const lbBOut = lb.brooder_exit_date || safeAddDays(lb.brooder_entry_date, 21);
        if (lbBOut) {
          const lbBExEnd = safeAddDays(lbBOut, BROODER_CLEANOUT);
          if (lbBExEnd && overlaps(tl.brooderIn, bEnd, lb.brooder_entry_date, lbBExEnd))
            out.push({
              soft: true,
              message:
                'Brooder ' +
                form.brooder +
                ' overlaps layer batch "' +
                lb.name +
                '" (brooder ' +
                fmtS(lb.brooder_entry_date) +
                '\u2013' +
                fmtS(lbBOut) +
                ')',
            });
        }
      }
      // Schooner check
      if (lbSchoonerId && lbSchoonerId === form.schooner && lb.schooner_entry_date && sEnd) {
        const lbSOut = lb.schooner_exit_date || safeAddDays(lb.schooner_entry_date, 119);
        if (lbSOut) {
          const lbSExEnd = safeAddDays(lbSOut, SCHOONER_CLEANOUT);
          if (lbSExEnd && overlaps(tl.schoonerIn, sEnd, lb.schooner_entry_date, lbSExEnd))
            out.push({
              soft: true,
              message:
                'Schooner ' +
                form.schooner +
                ' overlaps layer batch "' +
                lb.name +
                '" (schooner ' +
                fmtS(lb.schooner_entry_date) +
                '\u2013' +
                fmtS(lbSOut) +
                ')',
            });
        }
      }
    }
  }
  return out;
}
