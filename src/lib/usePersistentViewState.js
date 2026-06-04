import React from 'react';

const VIEW_STATE_PREFIX = 'wcf:view-state:';

function resolveInitialValue(initialValue) {
  return typeof initialValue === 'function' ? initialValue() : initialValue;
}

function isCompatibleValue(value, fallback) {
  if (fallback == null) return true;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === 'object') return value != null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === typeof fallback;
}

function readStoredValue(key, initialValue) {
  const fallback = resolveInitialValue(initialValue);
  if (typeof window === 'undefined' || !window.sessionStorage) return fallback;
  try {
    const raw = window.sessionStorage.getItem(VIEW_STATE_PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return isCompatibleValue(parsed, fallback) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(VIEW_STATE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Best effort only; navigation state should never break rendering.
  }
}

export function usePersistentViewState(key, initialValue) {
  const [value, setValue] = React.useState(() => readStoredValue(key, initialValue));

  React.useEffect(() => {
    writeStoredValue(key, value);
  }, [key, value]);

  return [value, setValue];
}
