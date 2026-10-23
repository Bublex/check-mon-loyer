// Service worker : reçoit l'annonce lue sur la page (ou saisie dans la fenêtre de l'extension),
// interroge les services publics de données et renvoie le verdict. Aucun serveur Loyer Juste :
// seules la localisation du logement et la recherche de la grille partent vers ces services.

import { checkListing } from './lib/check.js';
import { humanError } from './lib/net.js';

const CACHE_TTL = 15 * 60 * 1000;
const CHECK_TIMEOUT = 45000;
const results = new Map();

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function check(input, force) {
  const key = JSON.stringify(input);
  const hit = results.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  try {
    const value = await withTimeout(checkListing(input), CHECK_TIMEOUT);
    results.set(key, { at: Date.now(), value });
    if (results.size > 100) results.delete(results.keys().next().value);
    return value;
  } catch (error) {
    console.warn('[Loyer Juste]', error);
    return { error: humanError(error) };
  }
}

// Badge de l'icône : ! au-dessus du plafond, ✓ conforme, ? à préciser.
const BADGES = { over: ['!', '#b42318'], under: ['✓', '#1f7a4d'], depends: ['?', '#9a5b00'] };

function updateBadge(tabId, result) {
  const [text, color] = BADGES[result?.status] || [''];
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'check':
      check(message.input || {}, Boolean(message.force)).then((result) => {
        if (sender.tab?.id !== undefined) updateBadge(sender.tab.id, result);
        sendResponse(result);
      });
      return true;
    case 'clearBadge':
      if (sender.tab?.id !== undefined) updateBadge(sender.tab.id, null);
      break;
    default:
      break;
  }
  return false;
});
