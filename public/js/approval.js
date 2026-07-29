import { getPublicConsultation, resolveAssetUrl, setApiBaseUrl, submitApprovalDecision } from './api.js';

const $ = id => document.getElementById(id);
const elements = {
  loading: $('approvalLoading'), content: $('approvalContent'), error: $('approvalError'), errorCopy: $('approvalErrorCopy'),
  businessName: $('approvalBusinessName'), tagline: $('approvalTagline'), statusBadge: $('approvalStatusBadge'), logo: $('approvalLogo'), clientName: $('approvalClientName'), title: $('approvalTitle'), intro: $('approvalIntro'), contact: $('approvalContact'),
  versionCount: $('approvalVersionCount'), versions: $('approvalVersions'), decisionName: $('decisionName'), decisionComment: $('decisionComment'), approve: $('approveDesignButton'), requestChange: $('requestChangeButton'), decisionMessage: $('decisionMessage'),
  orderStatus: $('publicOrderStatus'), quote: $('publicQuote'), deposit: $('publicDeposit'), dueDate: $('publicDueDate')
};

const query = new URLSearchParams(window.location.search);
const token = query.get('token') || '';
const api = query.get('api') || '';
if (api) setApiBaseUrl(api);
let record = null;
let selectedVersionId = '';

function money(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function message(text, error = false) {
  elements.decisionMessage.textContent = text || '';
  elements.decisionMessage.classList.toggle('error-text', error);
}

function contactLink(label, value, href) {
  if (!value) return;
  const link = document.createElement('a');
  link.className = 'button button-ghost';
  link.textContent = `${label}: ${value}`;
  link.href = href;
  elements.contact.appendChild(link);
}

function approvalLabel(status) {
  return ({ pending: 'Awaiting decision', approved: 'Approved', changes_requested: 'Changes requested', draft: 'Draft' })[status] || 'Awaiting decision';
}

function renderVersion(version, checked) {
  const label = document.createElement('label');
  label.className = `approval-version-card${checked ? ' selected' : ''}`;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'designVersion';
  input.value = version.id;
  input.checked = checked;
  const image = document.createElement('img');
  image.src = resolveAssetUrl(version.imageUrl);
  image.alt = version.label;
  const body = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = `${version.label} · ${version.status}`;
  const copy = document.createElement('p');
  copy.textContent = version.changeSummary || 'Saved outfit visualization';
  body.append(heading, copy);
  input.addEventListener('change', () => {
    selectedVersionId = version.id;
    document.querySelectorAll('.approval-version-card').forEach(card => card.classList.remove('selected'));
    label.classList.add('selected');
  });
  label.append(input, image, body);
  return label;
}

function render(data) {
  record = data;
  const { brand, client, consultation } = data;
  document.documentElement.style.setProperty('--accent', brand.accentColour || '#7c5cff');
  elements.businessName.textContent = brand.businessName || 'Dresscode Studio';
  elements.tagline.textContent = brand.tagline || 'Client design approval';
  elements.logo.classList.toggle('hidden', !brand.logoImage);
  if (brand.logoImage) elements.logo.src = brand.logoImage;
  elements.clientName.textContent = client.name;
  elements.decisionName.value = client.name;
  elements.title.textContent = consultation.title;
  elements.intro.textContent = consultation.brief?.idea || `${brand.businessName || 'Your tailor'} prepared these visual design versions for your review.`;
  elements.statusBadge.textContent = approvalLabel(consultation.approval?.status);
  elements.statusBadge.className = `status-badge ${consultation.approval?.status === 'approved' ? 'ready' : consultation.approval?.status === 'changes_requested' ? 'error' : ''}`;

  elements.contact.replaceChildren();
  contactLink('Call', brand.phone, `tel:${brand.phone}`);
  contactLink('Email', brand.email, `mailto:${brand.email}`);
  const whatsapp = String(brand.whatsapp || '').replace(/\D/g, '');
  contactLink('WhatsApp', brand.whatsapp, whatsapp ? `https://wa.me/${whatsapp}` : '#');

  const versions = consultation.versions || [];
  elements.versionCount.textContent = `${versions.length} version${versions.length === 1 ? '' : 's'}`;
  selectedVersionId = consultation.approval?.versionId || versions.at(-1)?.id || '';
  elements.versions.replaceChildren(...versions.map(version => renderVersion(version, version.id === selectedVersionId)));
  elements.decisionComment.value = consultation.approval?.comment || '';

  const order = consultation.order || {};
  elements.orderStatus.textContent = String(order.orderStatus || 'consultation').replaceAll('_', ' ');
  elements.quote.textContent = money(order.quoteAmount);
  elements.deposit.textContent = `${money(order.depositAmount)} · ${String(order.depositStatus || 'not recorded').replaceAll('_', ' ')}`;
  elements.dueDate.textContent = order.dueDate || consultation.eventDate || 'To be confirmed';

  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.content.classList.remove('hidden');
}

async function decide(decision) {
  message('');
  if (!selectedVersionId) return message('Choose a design version first.', true);
  if (decision === 'request_changes' && !elements.decisionComment.value.trim()) {
    return message('Describe the requested change before sending it.', true);
  }
  elements.approve.disabled = true;
  elements.requestChange.disabled = true;
  try {
    const result = await submitApprovalDecision(token, {
      decision,
      versionId: selectedVersionId,
      clientName: elements.decisionName.value.trim(),
      comment: elements.decisionComment.value.trim()
    });
    record.consultation.approval = result.approval;
    elements.statusBadge.textContent = approvalLabel(result.approval.status);
    elements.statusBadge.className = `status-badge ${result.approval.status === 'approved' ? 'ready' : 'error'}`;
    message(result.approval.status === 'approved'
      ? 'Design approved. Your tailor can now continue with the order and final fitting.'
      : 'Your requested changes have been sent to the tailor.');
  } catch (error) {
    message(error.message, true);
  } finally {
    elements.approve.disabled = false;
    elements.requestChange.disabled = false;
  }
}

elements.approve.addEventListener('click', () => decide('approve'));
elements.requestChange.addEventListener('click', () => decide('request_changes'));

async function initialise() {
  if (!token) {
    elements.loading.classList.add('hidden');
    elements.error.classList.remove('hidden');
    elements.errorCopy.textContent = 'The approval token is missing. Ask the tailor to create a new branded approval link.';
    return;
  }
  try {
    render(await getPublicConsultation(token));
  } catch (error) {
    elements.loading.classList.add('hidden');
    elements.error.classList.remove('hidden');
    elements.statusBadge.textContent = 'Unavailable';
    elements.statusBadge.classList.add('error');
    elements.errorCopy.textContent = error.message;
  }
}

initialise();
