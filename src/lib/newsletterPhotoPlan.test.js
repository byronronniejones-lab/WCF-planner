import {describe, it, expect} from 'vitest';
import {placePlannedPhotos, pendingPlacementCount, fulfilledSlots, unfulfilledSlots} from './newsletterPhotoPlan.js';

const BLOCKS = [
  {type: 'heading', text: 'May Review'},
  {type: 'paragraph', text: 'Intro.'},
  {type: 'heading', text: 'Cattle', level: 3},
  {type: 'paragraph', text: '142 head.'},
  {type: 'divider'},
  {type: 'paragraph', text: 'Thanks for following along.'},
];

describe('placePlannedPhotos', () => {
  it('inserts a photo block right after the matching section heading', () => {
    const plan = [{id: 'pp-1', idea: 'The new calves', section: 'Cattle', photoId: 'nlp-1'}];
    const out = placePlannedPhotos(BLOCKS, plan);
    const cattleIdx = out.findIndex((b) => b.type === 'heading' && b.text === 'Cattle');
    expect(out[cattleIdx + 1]).toEqual({type: 'photo', photoId: 'nlp-1'});
    expect(out.length).toBe(BLOCKS.length + 1);
  });

  it('places before the trailing divider when no section matches', () => {
    const plan = [{id: 'pp-2', idea: 'A wide shot', section: 'Nonexistent', photoId: 'nlp-2'}];
    const out = placePlannedPhotos(BLOCKS, plan);
    const divIdx = out.findIndex((b) => b.type === 'divider');
    expect(out[divIdx - 1]).toEqual({type: 'photo', photoId: 'nlp-2'});
  });

  it('skips unfulfilled slots and never duplicates an already-placed photo', () => {
    const withPhoto = [...BLOCKS, {type: 'photo', photoId: 'nlp-1'}];
    const plan = [
      {id: 'pp-1', idea: 'calves', section: 'Cattle', photoId: 'nlp-1'}, // already placed
      {id: 'pp-2', idea: 'unshot', section: 'Cattle', photoId: null}, // unfulfilled
    ];
    expect(placePlannedPhotos(withPhoto, plan)).toEqual(withPhoto);
  });

  it('does not mutate the input blocks', () => {
    const copy = JSON.parse(JSON.stringify(BLOCKS));
    placePlannedPhotos(BLOCKS, [{id: 'pp-1', idea: 'x', section: 'Cattle', photoId: 'nlp-9'}]);
    expect(BLOCKS).toEqual(copy);
  });
});

describe('pendingPlacementCount + slot filters', () => {
  it('counts fulfilled slots not yet represented by a photo block', () => {
    const plan = [
      {id: 'a', photoId: 'nlp-1'},
      {id: 'b', photoId: null},
      {id: 'c', photoId: 'nlp-2'},
    ];
    expect(pendingPlacementCount(BLOCKS, plan)).toBe(2);
    expect(pendingPlacementCount([...BLOCKS, {type: 'photo', photoId: 'nlp-1'}], plan)).toBe(1);
    expect(fulfilledSlots(plan)).toHaveLength(2);
    expect(unfulfilledSlots(plan)).toHaveLength(1);
  });
});
