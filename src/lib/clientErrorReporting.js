const MAX_MSG_LEN = 200;
const MAX_STACK_LEN = 500;

const REDACT_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}/g, // JWT / base64 tokens
  /Bearer\s+\S+/gi,
  /supabase\.co\S*/gi,
  /access_token=[^\s&]+/gi,
  /refresh_token=[^\s&]+/gi,
  /apikey=[^\s&]+/gi,
  /password[=:]\s*\S+/gi,
  /localStorage\.\S+/gi,
];

export function redactString(str) {
  if (!str || typeof str !== 'string') return '';
  let out = str;
  for (const pat of REDACT_PATTERNS) {
    out = out.replace(pat, '[REDACTED]');
  }
  return out;
}

export function buildErrorEvent(source, error, extra) {
  const name = (error && error.name) || 'Error';
  const rawMsg = (error && error.message) || String(error || '');
  const rawStack = (error && error.stack) || '';

  const message = redactString(rawMsg).slice(0, MAX_MSG_LEN);
  const stackSummary = redactString(rawStack.split('\n').slice(0, 5).join('\n')).slice(0, MAX_STACK_LEN);

  return {
    source,
    error_kind: name,
    message,
    stack_summary: stackSummary,
    route: typeof window !== 'undefined' ? window.location.pathname : null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    timestamp: new Date().toISOString(),
    ...(extra || {}),
  };
}

let _sb = null;
let _reporting = false;

export function initErrorReporting(sb) {
  _sb = sb;
}

export async function reportError(source, error, extra) {
  const evt = buildErrorEvent(source, error, extra);

  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[WCF Error] ${evt.source}: ${evt.error_kind} - ${evt.message}`);
  }

  if (!_sb || _reporting) return;
  _reporting = true;
  try {
    await _sb.rpc('record_client_error', {
      p_source: evt.source,
      p_error_kind: evt.error_kind,
      p_message: evt.message,
      p_stack_summary: evt.stack_summary,
      p_route: evt.route,
      p_user_agent: evt.user_agent,
    });
  } catch (_e) {
    // best-effort -- never let error reporting break the app
  } finally {
    _reporting = false;
  }
}

let _listenersInstalled = false;
export function installGlobalListeners() {
  if (typeof window === 'undefined' || _listenersInstalled) return;
  _listenersInstalled = true;

  window.addEventListener('error', (event) => {
    reportError('window.error', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportError(
      'unhandledrejection',
      reason instanceof Error ? reason : new Error(String(reason || 'Unknown rejection')),
    );
  });
}
