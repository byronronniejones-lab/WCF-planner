// ============================================================================
// wcfSendEmail — fire-and-forget edge function call
// ============================================================================
// Phase 2.0.0: extracted verbatim from main.jsx. Calls the rapid-processor
// edge function. Never blocks the UI or shows errors to end users — failures
// are logged to console only, so a transient network hiccup doesn't
// interrupt a webform submission.
// ============================================================================

import {sb} from './supabase.js';

export function wcfSendEmail(type, data) {
  sb.functions.invoke('rapid-processor', {body: {type, data}}).catch((e) => console.warn('wcfSendEmail failed:', e));
}
