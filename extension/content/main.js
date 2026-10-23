// Point d'entrée sur les sites d'annonces : lit l'annonce, demande la vérification au service worker
// et affiche la pastille Loyer Juste. Les corrections saisies dans le panneau relancent le calcul.
(() => {
  'use strict';

  const { extractListing } = globalThis.LoyerExtract;
  const { mountPanel } = globalThis.LoyerUI;

  const DEFAULTS = { hiddenSites: [], position: 'right' };
  let settings = { ...DEFAULTS };
  let panel = null;
  let state = null;
  let currentKey = null;
  let requestId = 0;

  const keyOf = (l) => JSON.stringify([l.url, l.surface, l.rooms, l.furnished, l.rent, l.location]);

  /** Données envoyées au calcul : l'annonce, corrigée par ce que l'utilisateur a saisi. */
  function inputsFor(listing, edits = {}) {
    const where = { ...listing.location };
    if (edits.address) {
      // Adresse saisie : elle prime sur la position approximative de l'annonce.
      Object.assign(where, { address: edits.address, lat: undefined, lon: undefined });
    }
    const rent = { ...listing.rent, ...(edits.rent || {}) };
    if (edits.rent && edits.rent.amount !== listing.rent.amount) rent.base = null;
    return {
      listing: {
        surface: edits.surface !== undefined ? edits.surface : listing.surface,
        rooms: edits.rooms !== undefined ? edits.rooms : listing.rooms,
        furnished: edits.furnished !== undefined ? edits.furnished : listing.furnished,
        construction: edits.construction !== undefined ? edits.construction : listing.construction,
        rent,
        dpe: listing.dpe,
      },
      location: where,
      announcedCeiling: listing.announcedCeiling,
    };
  }

  function render() {
    if (!state) return;
    if (!panel) panel = mountPanel({ position: settings.position, handlers });
    panel.update(state);
  }

  async function run(force = false) {
    const id = ++requestId;
    state.loading = true;
    state.error = null;
    render();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'check', input: state.inputs, force });
      if (id !== requestId) return;
      if (response?.error) state.error = response.error;
      else state.result = response;
    } catch {
      if (id !== requestId) return;
      state.error = 'Extension indisponible, rechargez la page';
    }
    state.loading = false;
    render();
  }

  const handlers = {
    onRefresh: () => run(true),
    onEdit(edits) {
      state.edits = { ...state.edits, ...edits };
      state.inputs = inputsFor(state.listing, state.edits);
      run();
    },
    async onHideSite() {
      const hiddenSites = [...new Set([...settings.hiddenSites, location.hostname])];
      await chrome.storage.local.set({ hiddenSites });
    },
  };

  function teardown() {
    requestId++;
    panel?.destroy();
    panel = null;
    state = null;
    currentKey = null;
    chrome.runtime.sendMessage({ type: 'clearBadge' }).catch(() => {});
  }

  async function check() {
    const listing = extractListing(document, location);
    if (!listing) {
      if (state) teardown();
      return;
    }
    const key = keyOf(listing);
    if (key === currentKey) return;
    currentKey = key;
    settings = await chrome.storage.local.get(DEFAULTS);
    if (settings.hiddenSites.includes(location.hostname)) {
      teardown();
      return;
    }
    state = { listing, edits: {}, inputs: inputsFor(listing), result: null, loading: false, error: null };
    if (listing.roomShare) {
      state.result = { status: 'roomshare' };
      render();
      return;
    }
    run();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue ?? DEFAULTS[key];
    if (changes.hiddenSites && settings.hiddenSites.includes(location.hostname)) teardown();
    if (changes.position) panel?.setPosition(settings.position);
  });

  // La fenêtre de l'extension affiche l'annonce de l'onglet actif.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'getPageState') sendResponse({ state });
    return false;
  });

  // Sites qui changent d'annonce sans recharger la page, ou qui l'affichent après coup.
  let lastUrl = location.href;
  let tries = 0;
  const watcher = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(watcher);
      panel?.destroy();
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      tries = 0;
      currentKey = null;
      setTimeout(check, 800);
    } else if (!state && tries < 8) {
      tries++;
      check();
    }
  }, 1500);

  check();
})();
