import React from 'react';
import {findSequenceNeighbors} from '../lib/recordSequence.js';
import './RecordSequenceNav.css';

// Previous/Next record navigation. Renders nothing unless the current record
// sits inside a valid sequence handed through route state.
//
// Desktop: fixed edge chevrons with the target record in aria-label/title.
// Mobile: an in-flow compact row so controls do not cover dense record content.
//
// Props: seq, currentId, onNavigate, formatLabel
// Hooks: data-record-seq-nav / -prev / -next / -position / -fixed / -mobile

function defaultFormatLabel(item) {
  if (!item) return '';
  if (item.label) return item.label;
  return item.tag ? '#' + item.tag : 'Untagged';
}

export default function RecordSequenceNav({seq, currentId, onNavigate, formatLabel = defaultFormatLabel}) {
  const {index, total, prev, next} = findSequenceNeighbors(seq, currentId);
  // No reliable sequence -> render nothing (direct link, notification, related
  // click-through, or single-record list).
  if (index === -1) return null;

  const prevLabel = prev ? formatLabel(prev) : '';
  const nextLabel = next ? formatLabel(next) : '';

  return (
    <div data-record-seq-nav="1" data-record-seq-fixed="1" data-record-seq-mobile="1" className="record-sequence-nav">
      <button
        type="button"
        data-record-seq-prev="1"
        className="record-sequence-nav__button record-sequence-nav__button--prev"
        disabled={!prev}
        onClick={() => prev && onNavigate(prev.id)}
        aria-label={prev ? 'Previous record: ' + prevLabel : 'No previous record'}
        title={prev ? 'Previous: ' + prevLabel : 'No previous record'}
      >
        <span aria-hidden="true" className="record-sequence-nav__chevron">
          {'\u2039'}
        </span>
        <span className="record-sequence-nav__mobile-label">{prevLabel || 'Previous'}</span>
      </button>

      <span data-record-seq-position="1" className="record-sequence-nav__position">
        {index + 1} of {total}
      </span>

      <button
        type="button"
        data-record-seq-next="1"
        className="record-sequence-nav__button record-sequence-nav__button--next"
        disabled={!next}
        onClick={() => next && onNavigate(next.id)}
        aria-label={next ? 'Next record: ' + nextLabel : 'No next record'}
        title={next ? 'Next: ' + nextLabel : 'No next record'}
      >
        <span className="record-sequence-nav__mobile-label">{nextLabel || 'Next'}</span>
        <span aria-hidden="true" className="record-sequence-nav__chevron">
          {'\u203a'}
        </span>
      </button>
    </div>
  );
}
