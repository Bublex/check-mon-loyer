// Fenêtre de l'extension : verdict de l'annonce ouverte dans l'onglet actif,
// ou vérification d'un logement décrit à la main (adresse, surface, loyer…).

const { renderResult, CSS } = globalThis.LoyerUI;
document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));

const $ = (id) => document.getElementById(id);
let state = { listing: null, inputs: { listing: { rent: {} }, location: {} }, result: null, loading: false, error: null };
let requestId = 0;

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
    state.error = 'Vérification impossible';
  }
  state.loading = false;
  render();
}

const handlers = {
  onRefresh: () => run(true),
  onEdit(edits) {
    const location = { ...state.inputs.location };
    if (edits.address) location.address = edits.address;
    state.inputs = {
      ...state.inputs,
      location,
      listing: {
        ...state.inputs.listing,
        surface: edits.surface,
        rooms: edits.rooms,
        furnished: edits.furnished,
        kind: edits.kind,
        construction: edits.construction,
        rent: { ...state.inputs.listing.rent, ...edits.rent, base: null },
      },
    };
    run();
  },
};

function render() {
  const listing = state.listing;
  $('listing').hidden = !listing;
  $('hint').hidden = Boolean(listing || state.result) || !$('unread').hidden;
  if (listing) {
    $('listingTitle').textContent = listing.title || 'Annonce de location';
    $('listingMeta').textContent = state.result?.place?.label || [listing.location?.city, listing.location?.postcode].filter(Boolean).join(' ');
  }
  renderResult($('result'), state, handlers, {
    formOpen: !state.result || ['depends', 'incomplete', 'nolocation', 'nodata'].includes(state.result.status),
    submitLabel: listing ? 'Recalculer' : 'Vérifier ce loyer',
  });
}

const { hiddenSites = [] } = await chrome.storage.local.get({ hiddenSites: [] });
if (hiddenSites.length) {
  $('showEverywhere').hidden = false;
  $('showEverywhere').addEventListener('click', async () => {
    await chrome.storage.local.set({ hiddenSites: [] });
    $('showEverywhere').hidden = true;
  });
}

render();

// Annonce lue sur l'onglet actif : on reprend ses données (le résultat est en cache, c'est instantané).
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab?.id !== undefined) {
  try {
    const page = await chrome.tabs.sendMessage(tab.id, { type: 'getPageState' });
    if (page?.state) {
      state = { ...page.state, loading: false };
      if (state.result && !page.state.loading) render();
      else run();
    } else {
      // Site d'annonces, mais rien de reconnu : ce que l'extension lit, à copier pour améliorer la lecture.
      $('hint').hidden = true;
      $('unread').hidden = false;
      $('copyDiagnostic').addEventListener('click', async () => {
        const diagnostic = await chrome.tabs.sendMessage(tab.id, { type: 'getDiagnostic' });
        await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
        $('copyDiagnostic').textContent = 'Diagnostic copié';
      });
    }
  } catch {
    // Pas de script sur cette page (site non pris en charge) : saisie manuelle.
  }
}
