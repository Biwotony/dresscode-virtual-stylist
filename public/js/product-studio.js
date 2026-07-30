import { listClients, listConsultations } from './api.js';

const studioState = {
  app: null,
  client: null,
  consultation: null,
  clients: [],
  consultations: []
};

const $ = id => document.getElementById(id);

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function optionValue(id) {
  return $(id)?.value?.trim() || '';
}

function selectText(id) {
  const element = $(id);
  return element?.selectedOptions?.[0]?.textContent?.trim() || element?.value?.trim() || '';
}

function addOption(select, value) {
  if (!select || [...select.options].some(item => item.value === value || item.textContent === value)) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function setSelect(id, value) {
  const select = $(id);
  if (!select) return;
  addOption(select, value);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function setColour(value) {
  const colour = $('colour');
  const colourText = $('colourText');
  if (colour) colour.value = value;
  if (colourText) colourText.value = value;
  colour?.dispatchEvent(new Event('change', { bubbles: true }));
  colourText?.dispatchEvent(new Event('input', { bubbles: true }));
}

function baseIdea() {
  return ($('idea')?.value || '').split('\n\nDesign specification:')[0].trim();
}

const presets = {
  bridal: {
    event: 'Wedding', garment: 'Gown', fit: 'Structured', fabric: 'Satin', colour: '#f1eee8',
    idea: 'A refined made-to-measure bridal gown with a defined waist, elegant proportions and a balanced train. Keep the construction believable for a real fitting and production process.',
    silhouette: 'A-line', neckline: 'Sweetheart', sleeves: 'Full-length sleeves', detail: 'Lace overlay', coverage: 'Balanced coverage'
  },
  traditional: {
    event: 'Traditional ceremony', garment: 'Blouse and skirt', fit: 'Structured', fabric: 'Cotton blend', colour: '#8f2f55',
    idea: 'A confident traditional occasion look with intentional textile placement, polished structure and ceremonial detail. Preserve the character of the reference fabric without overcrowding the design.',
    silhouette: 'Peplum and full skirt', neckline: 'High neck', sleeves: 'Puff sleeves', detail: 'Print placement', coverage: 'Higher coverage'
  },
  evening: {
    event: 'Gala', garment: 'Gown', fit: 'Flowing', fabric: 'Silk', colour: '#173c6b',
    idea: 'An elegant evening gown with graceful movement, a clear focal detail and a premium finish. Keep the result sophisticated rather than costume-like.',
    silhouette: 'Column', neckline: 'One shoulder', sleeves: 'Sleeveless', detail: 'Beading', coverage: 'Balanced coverage'
  },
  suit: {
    event: 'Corporate event', garment: 'Suit', fit: 'Structured', fabric: 'Wool', colour: '#25324a',
    idea: 'A modern made-to-measure suit with clean tailoring, confident proportions and restrained detailing. Keep lapels, closures, trouser break and sleeve placement realistic.',
    silhouette: 'Double-breasted', neckline: 'Tailored lapel', sleeves: 'Full-length sleeves', detail: 'Clean minimal finish', coverage: 'Full coverage'
  }
};

function mountDesignLab() {
  const ideaPanel = $('idea')?.closest('.step-panel');
  if (!ideaPanel || $('designLabCard')) return;

  addOption($('fabric'), 'Wool');
  addOption($('fabric'), 'Ankara / kitenge');
  addOption($('fabric'), 'Brocade');

  const card = document.createElement('section');
  card.id = 'designLabCard';
  card.className = 'design-lab-card';
  card.innerHTML = `
    <div class="design-lab-heading">
      <div><p class="eyebrow">Design lab</p><h3>Turn a rough idea into a clear client direction</h3></div>
      <span class="status-badge">Tailor-controlled</span>
    </div>
    <p class="design-lab-copy">Start with a proven direction or build one from silhouette, neckline, sleeves and finish. The final wording is added to the consultation brief before generation.</p>
    <div class="preset-row" role="group" aria-label="Design direction presets">
      <button type="button" data-preset="bridal">Bridal</button>
      <button type="button" data-preset="traditional">Traditional</button>
      <button type="button" data-preset="evening">Evening</button>
      <button type="button" data-preset="suit">Modern suit</button>
    </div>
    <div class="design-tool-grid">
      <label><span>Reference use</span><select id="referenceUse"><option>Use the full garment direction</option><option>Use silhouette only</option><option>Use fabric or print only</option><option>Use construction detail only</option></select></label>
      <label><span>Silhouette</span><select id="designSilhouette"><option value="">Not specified</option><option>A-line</option><option>Ball gown</option><option>Mermaid</option><option>Column</option><option>Fit and flare</option><option>Peplum and full skirt</option><option>Kaftan</option><option>Single-breasted</option><option>Double-breasted</option></select></label>
      <label><span>Neckline / lapel</span><select id="designNeckline"><option value="">Not specified</option><option>High neck</option><option>Round neck</option><option>V-neck</option><option>Sweetheart</option><option>Off shoulder</option><option>One shoulder</option><option>Tailored lapel</option></select></label>
      <label><span>Sleeves</span><select id="designSleeves"><option value="">Not specified</option><option>Sleeveless</option><option>Short sleeves</option><option>Three-quarter sleeves</option><option>Full-length sleeves</option><option>Puff sleeves</option><option>Bell sleeves</option></select></label>
      <label><span>Surface finish</span><select id="designDetail"><option value="">Not specified</option><option>Clean minimal finish</option><option>Lace overlay</option><option>Beading</option><option>Embroidery</option><option>Print placement</option><option>Contrast trim</option><option>Hand-finished buttons</option></select></label>
      <label><span>Coverage</span><select id="designCoverage"><option value="">Not specified</option><option>Balanced coverage</option><option>Higher coverage</option><option>Full coverage</option><option>Open neckline</option><option>Open back</option></select></label>
    </div>
    <button id="applyDesignDirection" class="button button-secondary" type="button">Add direction to the brief</button>
    <p id="designLabMessage" class="inline-message" role="status"></p>
  `;
  ideaPanel.insertBefore(card, $('idea').previousElementSibling);

  card.querySelectorAll('[data-preset]').forEach(button => {
    button.addEventListener('click', () => {
      const preset = presets[button.dataset.preset];
      setSelect('event', preset.event);
      setSelect('garment', preset.garment);
      setSelect('fit', preset.fit);
      setSelect('fabric', preset.fabric);
      setColour(preset.colour);
      $('idea').value = preset.idea;
      $('designSilhouette').value = preset.silhouette;
      $('designNeckline').value = preset.neckline;
      $('designSleeves').value = preset.sleeves;
      $('designDetail').value = preset.detail;
      $('designCoverage').value = preset.coverage;
      $('idea').dispatchEvent(new Event('input', { bubbles: true }));
      card.querySelectorAll('[data-preset]').forEach(item => item.classList.toggle('active', item === button));
      $('designLabMessage').textContent = `${button.textContent.trim()} direction loaded. Adjust it, then add the final direction to the brief.`;
    });
  });

  $('applyDesignDirection').addEventListener('click', () => {
    const details = [
      optionValue('referenceUse'),
      optionValue('designSilhouette') && `${optionValue('designSilhouette')} silhouette`,
      optionValue('designNeckline') && `${optionValue('designNeckline')} neckline or lapel`,
      optionValue('designSleeves'),
      optionValue('designDetail'),
      optionValue('designCoverage')
    ].filter(Boolean);
    if (!details.length) {
      $('designLabMessage').textContent = 'Choose at least one design direction first.';
      return;
    }
    const idea = baseIdea() || 'Create a realistic custom-fashion design suitable for production.';
    $('idea').value = `${idea}\n\nDesign specification: ${details.join('; ')}. Keep every named construction choice clear, coherent and realistic for a tailor to reproduce.`;
    $('idea').dispatchEvent(new Event('input', { bubbles: true }));
    $('designLabMessage').textContent = 'The structured direction is now part of the generation and consultation brief.';
  });
}

function metricCard(label, value, note) {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function renderPulse() {
  const mount = $('studioPulse');
  if (!mount) return;
  const awaiting = studioState.consultations.filter(item => item.approvalStatus === 'pending').length;
  const activeOrders = studioState.consultations.filter(item => ['deposit_received', 'in_production', 'ready'].includes(item.orderStatus)).length;
  const approved = studioState.consultations.filter(item => item.approvalStatus === 'approved').length;
  mount.innerHTML = [
    metricCard('Clients', studioState.clients.length, 'saved records'),
    metricCard('Consultations', studioState.consultations.length, 'design histories'),
    metricCard('Awaiting approval', awaiting, 'needs follow-up'),
    metricCard('Active orders', activeOrders, `${approved} approved designs`)
  ].join('');
}

async function refreshPulse(attempt = 0) {
  try {
    const [clients, consultations] = await Promise.all([listClients(), listConsultations()]);
    studioState.clients = clients.clients || [];
    studioState.consultations = consultations.consultations || [];
    renderPulse();
  } catch (error) {
    if (attempt < 5) window.setTimeout(() => refreshPulse(attempt + 1), 700 * (attempt + 1));
  }
}

function mountPulse() {
  const setup = $('consultationSetupMount');
  if (!setup || $('studioPulsePanel')) return;
  const panel = document.createElement('section');
  panel.id = 'studioPulsePanel';
  panel.className = 'panel studio-pulse-panel';
  panel.innerHTML = `
    <div class="mini-heading">
      <div><p class="eyebrow">Studio pulse</p><h2>What needs attention</h2></div>
      <span class="status-badge">Live workspace</span>
    </div>
    <div id="studioPulse" class="studio-pulse">${metricCard('Clients', '—', 'loading')}</div>
  `;
  setup.prepend(panel);
  refreshPulse();
}

function measurementRows() {
  const measurements = studioState.app?.measurements || {};
  const rows = Object.values(measurements).map(item => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)} ${escapeHtml(item.unit)}</td></tr>`);
  return rows.length ? rows.join('') : '<tr><td colspan="2">No measurements recorded.</td></tr>';
}

function latestVersion() {
  const versions = studioState.consultation?.versions || [];
  const approvedId = studioState.consultation?.approval?.versionId;
  return versions.find(item => item.id === approvedId) || versions.at(-1) || null;
}

function productionSummary() {
  const brief = studioState.app?.brief || studioState.consultation?.brief || {};
  const client = studioState.client || {};
  return [
    `${client.name || optionValue('clientName') || 'Client'} — ${optionValue('consultationTitle') || studioState.consultation?.title || 'Custom garment'}`,
    `Event / due date: ${optionValue('consultationDate') || optionValue('orderDueDate') || 'Not set'}`,
    `Design: ${[brief.garment, brief.fit, brief.fabric, brief.colour].filter(Boolean).join(' · ') || 'See approved version'}`,
    `Approval: ${$('approvalBadge')?.textContent?.trim() || 'Draft'}`,
    `Order: ${selectText('orderStatus') || 'Consultation'} · Quote KES ${optionValue('quoteAmount') || '0'} · Deposit KES ${optionValue('depositAmount') || '0'}`,
    `Notes: ${optionValue('orderNotes') || optionValue('consultationNotes') || 'None'}`
  ].join('\n');
}

function printProductionBrief() {
  const consultationTitle = optionValue('consultationTitle') || studioState.consultation?.title || 'Custom garment work order';
  const clientName = optionValue('clientName') || studioState.client?.name || 'Client';
  const brief = studioState.app?.brief || studioState.consultation?.brief || {};
  const version = latestVersion();
  const image = version?.imageDataUrl || studioState.app?.generatedImage || '';
  const studioName = optionValue('businessName') || 'Dresscode Studio';
  const approval = $('approvalBadge')?.textContent?.trim() || 'Draft';
  const popup = window.open('', '_blank');
  if (popup) popup.opener = null;
  if (!popup) {
    $('productionMessage').textContent = 'Allow pop-ups to print the production brief.';
    return;
  }
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(consultationTitle)}</title><style>
    body{font-family:Arial,sans-serif;color:#17202a;margin:32px;line-height:1.4}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #17202a;padding-bottom:16px;margin-bottom:24px}h1{margin:0;font-size:28px}h2{font-size:17px;margin:24px 0 8px}p{margin:4px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{border:1px solid #cfd6df;border-radius:10px;padding:14px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px;border-bottom:1px solid #e4e8ed}th{width:55%}.design{display:grid;grid-template-columns:220px 1fr;gap:20px}.design img{width:100%;max-height:320px;object-fit:contain;border:1px solid #d9dee5;border-radius:8px}.status{font-weight:700;text-transform:capitalize}.fine{font-size:11px;color:#65717f;margin-top:24px}@media print{body{margin:12mm}.no-print{display:none}}
  </style></head><body>
    <header><div><strong>${escapeHtml(studioName)}</strong><h1>${escapeHtml(consultationTitle)}</h1><p>${escapeHtml(clientName)}</p></div><div><p><strong>Status</strong></p><p class="status">${escapeHtml(approval)}</p><p>${escapeHtml(optionValue('consultationDate') || optionValue('orderDueDate') || '')}</p></div></header>
    <section class="design">${image ? `<img src="${image}" alt="Approved design">` : '<div class="card">No saved design image.</div>'}<div><h2>Approved design direction</h2><p>${escapeHtml(brief.idea || optionValue('idea') || 'See consultation notes.')}</p><div class="grid"><div class="card"><strong>Garment</strong><p>${escapeHtml(brief.garment || selectText('garment'))}</p><strong>Fit</strong><p>${escapeHtml(brief.fit || selectText('fit'))}</p></div><div class="card"><strong>Fabric</strong><p>${escapeHtml(brief.fabric || selectText('fabric'))}</p><strong>Colour</strong><p>${escapeHtml(brief.colour || optionValue('colourText'))}</p></div></div></div></section>
    <div class="grid"><section><h2>Measurements</h2><table>${measurementRows()}</table></section><section><h2>Order</h2><table><tr><th>Quote</th><td>KES ${escapeHtml(optionValue('quoteAmount') || '0')}</td></tr><tr><th>Deposit</th><td>KES ${escapeHtml(optionValue('depositAmount') || '0')}</td></tr><tr><th>Deposit status</th><td>${escapeHtml(selectText('depositStatus'))}</td></tr><tr><th>Order status</th><td>${escapeHtml(selectText('orderStatus'))}</td></tr><tr><th>Due date</th><td>${escapeHtml(optionValue('orderDueDate'))}</td></tr></table></section></div>
    <section><h2>Production notes</h2><div class="card">${escapeHtml(optionValue('orderNotes') || optionValue('consultationNotes') || 'No production notes recorded.')}</div></section>
    <p class="fine">This document records the agreed visual direction and consultation information. The virtual preview is not a physical fitting or a pattern-cutting guarantee; final construction and fit remain with the tailor.</p>
    <button class="no-print" onclick="window.print()">Print work order</button>
  </body></html>`);
  popup.document.close();
}

async function copyProductionSummary() {
  const text = productionSummary();
  try {
    await navigator.clipboard.writeText(text);
    $('productionMessage').textContent = 'Production summary copied.';
  } catch {
    $('productionMessage').textContent = 'Could not copy automatically. Use the print brief instead.';
  }
}

function updateProductionState() {
  const enabled = Boolean(studioState.consultation || optionValue('consultationTitle'));
  const printButton = $('printProductionBrief');
  const copyButton = $('copyProductionSummary');
  if (printButton) printButton.disabled = !enabled;
  if (copyButton) copyButton.disabled = !enabled;
  const version = latestVersion();
  const status = $('productionReadyStatus');
  if (status) status.textContent = version ? 'Design attached' : enabled ? 'Brief ready' : 'Select consultation';
}

function mountProductionHandoff() {
  const toolsMount = $('consultationToolsMount');
  if (!toolsMount || $('productionHandoff')) return;
  const section = document.createElement('section');
  section.id = 'productionHandoff';
  section.className = 'panel production-handoff';
  section.innerHTML = `
    <div class="mini-heading">
      <div><p class="eyebrow">Decision to production</p><h2>Approved design handoff</h2></div>
      <span id="productionReadyStatus" class="status-badge">Select consultation</span>
    </div>
    <p>Turn the client record, measurements, chosen design, approval and order details into one production-ready brief.</p>
    <div class="handoff-steps"><span>Client</span><i>→</i><span>Visual</span><i>→</i><span>Approval</span><i>→</i><span>Work order</span></div>
    <div class="consultation-actions">
      <button id="printProductionBrief" class="button button-primary" type="button" disabled>Print production brief</button>
      <button id="copyProductionSummary" class="button button-secondary" type="button" disabled>Copy production summary</button>
    </div>
    <p id="productionMessage" class="inline-message" role="status"></p>
  `;
  toolsMount.appendChild(section);
  $('printProductionBrief').addEventListener('click', printProductionBrief);
  $('copyProductionSummary').addEventListener('click', copyProductionSummary);
  updateProductionState();
}

window.addEventListener('dresscode:app-state', event => {
  studioState.app = event.detail;
  updateProductionState();
});
window.addEventListener('dresscode:load-client', event => {
  studioState.client = event.detail?.client || null;
  refreshPulse();
  updateProductionState();
});
window.addEventListener('dresscode:load-consultation', event => {
  studioState.consultation = event.detail?.consultation || null;
  studioState.client = event.detail?.client || studioState.client;
  refreshPulse();
  updateProductionState();
});
window.addEventListener('dresscode:set-active-consultation', event => {
  if (!event.detail?.consultationId) studioState.consultation = null;
  updateProductionState();
});

document.addEventListener('change', event => {
  if (event.target.closest?.('#consultationSetupMount, #consultationToolsMount, .step-panel')) updateProductionState();
});

function initialise() {
  mountPulse();
  mountDesignLab();
  mountProductionHandoff();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise);
else initialise();
