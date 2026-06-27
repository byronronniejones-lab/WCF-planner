import {describe, expect, it} from 'vitest';
import {normalizeProcessingStatus, processingStatusLabel} from './processingStatusDisplay.js';

describe('processingStatusDisplay', () => {
  it('maps stored planner values to the uniform display vocabulary', () => {
    expect(processingStatusLabel('planned')).toBe('Planned');
    expect(processingStatusLabel('scheduled')).toBe('Planned');
    expect(processingStatusLabel('active')).toBe('In Process');
    expect(processingStatusLabel('processed')).toBe('Complete');
    expect(processingStatusLabel('complete')).toBe('Complete');
  });

  it('normalizes empty and unknown values conservatively to planned', () => {
    expect(normalizeProcessingStatus(null)).toBe('planned');
    expect(normalizeProcessingStatus('')).toBe('planned');
    expect(normalizeProcessingStatus('not-a-real-status')).toBe('planned');
  });
});
