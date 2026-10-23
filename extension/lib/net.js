// Requêtes vers les services publics de données : délai maximal, annulation, pas de cookies ni d'en-tête Referer.

export const DEFAULT_TIMEOUT = 20000;

export async function request(url, { timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const signals = [AbortSignal.timeout(timeout)];
  if (signal) signals.push(signal);
  const res = await fetch(url, {
    credentials: 'omit',
    // Le service n'a pas à savoir depuis quelle annonce vous consultez.
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.any(signals),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

export async function requestJson(url, options) {
  return (await request(url, options)).json();
}

export async function requestBuffer(url, options) {
  return (await request(url, options)).arrayBuffer();
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

/** Petit cache en mémoire du service worker : les grilles changent une fois par an. */
const cache = new Map();

export async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

export const DAY = 24 * 60 * 60 * 1000;

/** Message d'erreur compréhensible pour l'interface. */
export function humanError(error) {
  if (!error) return 'Erreur inconnue';
  if (error.name === 'TimeoutError') return 'Le service de données met trop de temps à répondre';
  if (error.name === 'AbortError') return 'Vérification annulée';
  if (error instanceof HttpError) {
    if (error.status >= 500) return 'Le service de données rencontre une erreur';
    return `Le service de données a répondu ${error.status}`;
  }
  if (error instanceof TypeError) return 'Service de données injoignable (réseau)';
  return error.message || 'Erreur inconnue';
}
