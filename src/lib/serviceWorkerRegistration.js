export const APP_SERVICE_WORKER_PATH = '/sw.js';

export function shouldRegisterServiceWorker(env = import.meta.env) {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    (env.PROD || env.MODE === 'test')
  );
}

export function registerAppServiceWorker() {
  if (!shouldRegisterServiceWorker()) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(APP_SERVICE_WORKER_PATH, {scope: '/'}).catch((error) => {
      console.warn('WCF service worker registration failed:', error);
    });
  });
}
