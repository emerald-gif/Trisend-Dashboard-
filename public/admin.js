'use strict';
// ── Firebase Config ────────────────────────────────────────────────────────────
firebase.initializeApp({
  apiKey:            "AIzaSyCgaYVSaKtXAQOVRTRfAGV6cWjPqG9x4Tc",
  authDomain:        "trisend-e7250.firebaseapp.com",
  projectId:         "trisend-e7250",
  storageBucket:     "trisend-e7250.firebasestorage.app",
  messagingSenderId: "1088068014414",
  appId:             "1:1088068014414:web:77c1f5c1de544b6ab5ce1f",
});
const auth = firebase.auth();

// ── State ──────────────────────────────────────────────────────────────────────
let currentToken   = null;
let currentSection = 'overview';
let allData = { users:[], links:[], qrcodes:[], biopages:[], payments:[], broadcasts:[] };
let bcTarget = 'all'; // active broadcast target

// ── DOM ────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Auth ───────────────────────────────────────────────────────────────────────
$('btn-google-login').addEventListener('click', async () => {
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    const err = $('login-error');
    err.textContent = e.code === 'auth/popup-closed-by-user'
      ? 'Sign-in cancelled.'
      : 'Sign-in failed. Make sure your account is authorised as admin.';
    err.style.display = 'block';
  }
});

$('btn-logout').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(async user => {
  if (!user) {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    currentToken = null;
    return;
  }

  currentToken = await user.getIdToken();
  setInterval(async () => { currentToken = await user.getIdToken(true); }, 50 * 60 * 1000);

  // Gate: verify they are actually an admin
  const check = await api('/api/stats');
  if (check._error === 'Not an admin') {
    showToast('Your account is not authorised as admin.', 'error');
    await auth.signOut();
    return;
  }

  $('admin-name').textContent   = user.displayName || user.email;
  $('admin-avatar').textContent = (user.displayName || user.email || 'A')[0].toUpperCase();

  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  loadSection('overview');
});

// ── API ────────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) return { _error: data.error || 'Request failed' };
    return data;
  } catch {
    return { _error: 'Network error' };
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────────
const pageMeta = {
  overview:   ['Overview',     'Trisend platform stats'],
  users:      ['Users',        'Manage accounts & premium'],
  links:      ['Short Links',  'All shortened URLs'],
  qrcodes:    ['QR Codes',     'Dynamic QR codes'],
  biopages:   ['Bio Pages',    'Link-in-bio pages'],
  payments:   ['Payments',     'Premium payment history'],
  broadcasts: ['Broadcasts',   'Send messages to your users'],
};

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const s = el.dataset.section;
    if (s === currentSection) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    $(`section-${s}`).classList.add('active');
    currentSection = s;
    const [title, sub] = pageMeta[s] || ['—', '—'];
    $('topbar-title').textContent = title;
    $('topbar-sub').textContent   = sub;
    loadSection(s);
  });
});

$('btn-refresh').addEventListener('click', () => loadSection(currentSection));

function loadSection(section) {
  const btn = $('btn-refresh');
  btn.classList.add('spinning');
  const loaders = {
    overview:   loadOverview,
    users:      loadUsers,
    links:      loadLinks,
    qrcodes:    loadQRCodes,
    biopages:   loadBioPages,
    payments:   loadPayments,
    broadcasts: loadBroadcasts,
  };
  (loaders[section] || loadOverview)().finally(() => btn.classList.remove('spinning'));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
async function loadOverview() {
  const d = await api('/api/stats');
  if (d._error) { showToast(d._error, 'error'); return; }

  $('stats-grid').innerHTML = [
    statCard('Total Users',     d.users.total,          'icon-purple', iconUsers(),  `${d.users.premium} premium · ${d.users.free} free`),
    statCard('Premium Active',  d.users.premium,        'icon-green',  iconStar(),   `${d.users.expired} expired`),
    statCard('Short Links',     d.content.shortlinks,   'icon-blue',   iconLink(),   `${d.engagement.totalClicks.toLocaleString()} total clicks`),
    statCard('QR Codes',        d.content.qrcodes,      'icon-orange', iconQR(),     `${d.engagement.totalScans.toLocaleString()} total scans`),
    statCard('Bio Pages',       d.content.biopages,     'icon-rose',   iconPage(),   'Link-in-bio pages'),
    statCard('Broadcasts Sent', d.broadcasts || 0,      'icon-indigo', iconBroadcast(), 'Messages sent to users'),
    statCard('Engagement',      (d.engagement.totalClicks + d.engagement.totalScans).toLocaleString(), 'icon-cyan', iconChart(), 'Clicks + scans'),
  ].join('');

  $('badge-users').textContent      = d.users.total;
  $('badge-links').textContent      = d.content.shortlinks;
  $('badge-qr').textContent         = d.content.qrcodes;
  $('badge-bio').textContent        = d.content.biopages;
  $('badge-broadcasts').textContent = d.broadcasts || 0;
}

function statCard(label, value, iconClass, iconSvg, sub) {
  return `<div class="stat-card">
    <div class="icon ${iconClass}">${iconSvg}</div>
    <div class="label">${label}</div>
    <div class="value">${value ?? '—'}</div>
    <div class="sub">${sub}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadUsers() {
  const d = await api('/api/users');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.users = d.users;
  renderUsers(d.users);
  bindSearch('search-users', () => {
    const q = $('search-users').value.toLowerCase();
    renderUsers(allData.users.filter(u => (u.email + u.displayName).toLowerCase().includes(q)));
  });
}

function renderUsers(list) {
  $('footer-users').textContent = `Showing ${list.length} users`;
  const now = Date.now();
  if (!list.length) {
    $('tbody-users').innerHTML = `<tr><td colspan="5" class="table-empty">No users found</td></tr>`;
    return;
  }
  $('tbody-users').innerHTML = list.map(u => {
    const isPremium = u.plan === 'premium';
    const isExpired = isPremium && u.premiumExpiresAt && u.premiumExpiresAt < now;
    const pill = isExpired
      ? `<span class="pill pill-expired">Expired</span>`
      : isPremium
        ? `<span class="pill pill-premium">⭐ Premium</span>`
        : `<span class="pill pill-free">Free</span>`;
    const adminTag = u.grantedByAdmin
      ? `<span class="pill pill-warn" style="margin-left:4px;font-size:10px">admin</span>` : '';
    return `<tr>
      <td>
        <div style="font-weight:600">${esc(u.displayName)}</div>
        <div style="color:var(--muted);font-size:12px">${esc(u.email)}</div>
      </td>
      <td>${pill}${adminTag}</td>
      <td style="color:var(--muted);font-size:12px">${fmtDate(u.premiumExpiresAt)}</td>
      <td style="color:var(--muted);font-size:12px">${fmtDate(u.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-sm btn-success" onclick="openGrantModal('${u.uid}','${esc(u.email)}')">${iconPlus()} Grant</button>
          ${isPremium && !isExpired
            ? `<button class="btn btn-sm btn-danger" onclick="revokeUser('${u.uid}','${esc(u.email)}')">${iconX()} Revoke</button>`
            : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openGrantModal(uid, email) {
  $('modal-grant-desc').textContent = `Grant premium to: ${email}`;
  $('grant-days').value = '30';
  openModal('modal-grant');
  $('btn-grant-confirm').onclick = async () => {
    const days = parseInt($('grant-days').value) || 30;
    closeModal('modal-grant');
    const r = await api(`/api/users/${uid}/grant-premium`, { method:'POST', body:{ days } });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast(`Premium granted for ${days} days`, 'success');
    loadUsers();
  };
}
$('btn-grant-cancel').addEventListener('click', () => closeModal('modal-grant'));

function revokeUser(uid, email) {
  confirm2('Revoke Premium', `Remove premium from ${email}? They lose access immediately.`, async () => {
    const r = await api(`/api/users/${uid}/revoke-premium`, { method:'POST' });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast('Premium revoked', 'success');
    loadUsers();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHORT LINKS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadLinks() {
  const d = await api('/api/links');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.links = d.links;
  renderLinks(d.links);
  bindSearch('search-links', () => {
    const q = $('search-links').value.toLowerCase();
    renderLinks(allData.links.filter(l => (l.code + l.destination).toLowerCase().includes(q)));
  });
}

function renderLinks(list) {
  $('footer-links').textContent = `Showing ${list.length} links`;
  if (!list.length) {
    $('tbody-links').innerHTML = `<tr><td colspan="5" class="table-empty">No links found</td></tr>`;
    return;
  }
  $('tbody-links').innerHTML = list.map(l => `<tr>
    <td>
      <span class="code-cell">${esc(l.code)}</span>
      ${l.hasPassword ? `<span class="pill pill-warn" style="margin-left:4px;font-size:10px">🔒</span>` : ''}
    </td>
    <td><div class="url-cell" title="${esc(l.destination)}">${esc(l.destination)}</div></td>
    <td><strong>${l.clicks}</strong></td>
    <td style="color:var(--muted);font-size:12px">${fmtDate(l.createdAt)}</td>
    <td>
      <div class="actions">
        <button class="btn btn-sm btn-danger" onclick="deleteLink('${esc(l.code)}')">${iconTrash()} Delete</button>
      </div>
    </td>
  </tr>`).join('');
}

function deleteLink(code) {
  confirm2('Delete Link', `Permanently delete short link /${code}? All click data will be lost.`, async () => {
    const r = await api(`/api/links/${code}`, { method:'DELETE' });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast('Link deleted', 'success');
    loadLinks();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  QR CODES
// ═══════════════════════════════════════════════════════════════════════════════
async function loadQRCodes() {
  const d = await api('/api/qrcodes');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.qrcodes = d.qrcodes;
  renderQRCodes(d.qrcodes);
  bindSearch('search-qr', () => {
    const q = $('search-qr').value.toLowerCase();
    renderQRCodes(allData.qrcodes.filter(c => (c.code + c.destination + (c.label||'')).toLowerCase().includes(q)));
  });
}

function renderQRCodes(list) {
  $('footer-qrcodes').textContent = `Showing ${list.length} QR codes`;
  if (!list.length) {
    $('tbody-qrcodes').innerHTML = `<tr><td colspan="5" class="table-empty">No QR codes found</td></tr>`;
    return;
  }
  $('tbody-qrcodes').innerHTML = list.map(q => `<tr>
    <td>
      <span class="code-cell">${esc(q.code)}</span>
      ${q.label ? `<div style="color:var(--muted);font-size:11px;margin-top:2px">${esc(q.label)}</div>` : ''}
    </td>
    <td><div class="url-cell" title="${esc(q.destination)}">${esc(q.destination)}</div></td>
    <td><strong>${q.scans}</strong></td>
    <td style="color:var(--muted);font-size:12px">${fmtDate(q.createdAt)}</td>
    <td>
      <div class="actions">
        <button class="btn btn-sm btn-danger" onclick="deleteQR('${esc(q.code)}')">${iconTrash()} Delete</button>
      </div>
    </td>
  </tr>`).join('');
}

function deleteQR(code) {
  confirm2('Delete QR Code', `Permanently delete QR code ${code}? It will stop scanning immediately.`, async () => {
    const r = await api(`/api/qrcodes/${code}`, { method:'DELETE' });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast('QR code deleted', 'success');
    loadQRCodes();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BIO PAGES
// ═══════════════════════════════════════════════════════════════════════════════
async function loadBioPages() {
  const d = await api('/api/biopages');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.biopages = d.pages;
  renderBioPages(d.pages);
  bindSearch('search-bio', () => {
    const q = $('search-bio').value.toLowerCase();
    renderBioPages(allData.biopages.filter(p => (p.username + p.title).toLowerCase().includes(q)));
  });
}

function renderBioPages(list) {
  $('footer-biopages').textContent = `Showing ${list.length} pages`;
  if (!list.length) {
    $('tbody-biopages').innerHTML = `<tr><td colspan="5" class="table-empty">No bio pages found</td></tr>`;
    return;
  }
  $('tbody-biopages').innerHTML = list.map(p => `<tr>
    <td><span class="code-cell">@${esc(p.username)}</span></td>
    <td>${esc(p.title)}</td>
    <td>${p.linkCount} links</td>
    <td style="color:var(--muted);font-size:12px">${fmtDate(p.createdAt)}</td>
    <td>
      <div class="actions">
        <button class="btn btn-sm btn-danger" onclick="deleteBioPage('${esc(p.username)}')">${iconTrash()} Delete</button>
      </div>
    </td>
  </tr>`).join('');
}

function deleteBioPage(username) {
  confirm2('Delete Bio Page', `Permanently delete @${username}'s Link-in-Bio page?`, async () => {
    const r = await api(`/api/biopages/${username}`, { method:'DELETE' });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast('Bio page deleted', 'success');
    loadBioPages();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadPayments() {
  const d = await api('/api/payments');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.payments = d.payments;
  renderPayments(d.payments);
  bindSearch('search-payments', () => {
    const q = $('search-payments').value.toLowerCase();
    renderPayments(allData.payments.filter(p => (p.email + p.paystackRef).toLowerCase().includes(q)));
  });
}

function renderPayments(list) {
  $('footer-payments').textContent = `${list.length} payment records`;
  if (!list.length) {
    $('tbody-payments').innerHTML = `<tr><td colspan="5" class="table-empty">No payments found</td></tr>`;
    return;
  }
  const now = Date.now();
  $('tbody-payments').innerHTML = list.map(p => {
    const active = p.premiumExpiresAt && p.premiumExpiresAt > now;
    return `<tr>
      <td style="font-weight:500">${esc(p.email)}</td>
      <td><span class="code-cell">${esc(p.paystackRef)}</span></td>
      <td>${p.grantedByAdmin
        ? `<span class="pill pill-warn">Admin Grant</span>`
        : `<span class="pill pill-active">Paystack</span>`}</td>
      <td style="color:var(--muted);font-size:12px">${fmtDate(p.premiumStartedAt)}</td>
      <td>${active
        ? `<span class="pill pill-premium">${fmtDate(p.premiumExpiresAt)}</span>`
        : `<span class="pill pill-expired">${fmtDate(p.premiumExpiresAt)}</span>`}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BROADCASTS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadBroadcasts() {
  const d = await api('/api/broadcasts');
  if (d._error) { showToast(d._error, 'error'); return; }
  allData.broadcasts = d.broadcasts;
  renderBroadcastHistory(d.broadcasts);
}

function renderBroadcastHistory(list) {
  const container = $('bc-history-list');
  if (!list.length) {
    container.innerHTML = `<div class="table-card" style="padding:32px;text-align:center;color:var(--muted)">No broadcasts sent yet.</div>`;
    return;
  }
  container.innerHTML = `<div class="bc-history">${list.map(b => {
    const targetLabel = b.target === 'all'
      ? `<span class="pill pill-all">👥 All Users</span>`
      : b.target === 'premium'
        ? `<span class="pill pill-premium">⭐ Premium</span>`
        : `<span class="pill pill-free">🆓 Free</span>`;
    return `<div class="bc-card target-${b.target}">
      <div class="bc-card-top">
        <div>
          <div class="bc-card-title">${esc(b.title)}</div>
          <div class="bc-card-meta">${targetLabel} &nbsp;·&nbsp; ${fmtDateTime(b.createdAt)} &nbsp;·&nbsp; by ${esc(b.sentByEmail)}</div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="deleteBroadcast('${b.id}')">${iconTrash()}</button>
      </div>
      <div class="bc-card-msg">${esc(b.message)}</div>
    </div>`;
  }).join('')}</div>`;
}

// ── Target selector ────────────────────────────────────────────────────────────
document.querySelectorAll('.target-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.target-btn').forEach(b => b.className = 'target-btn');
    bcTarget = btn.dataset.target;
    btn.classList.add(`active-${bcTarget}`);
    updatePreview();
  });
});

// ── Live preview ───────────────────────────────────────────────────────────────
function updatePreview() {
  const title   = $('bc-title').value.trim()   || 'Your title here';
  const message = $('bc-message').value.trim() || 'Your message will appear here…';
  const tagMap  = { all:'📢 Message for all users', premium:'⭐ For Premium members', free:'👋 For Free users' };
  const banner  = $('preview-banner');

  $('preview-tag').textContent   = tagMap[bcTarget];
  $('preview-title').textContent = title;
  $('preview-msg').textContent   = message;
  banner.className = `preview-banner target-${bcTarget}`;
}

$('bc-title').addEventListener('input',   updatePreview);
$('bc-message').addEventListener('input', updatePreview);

// ── Send broadcast ─────────────────────────────────────────────────────────────
$('btn-send-broadcast').addEventListener('click', async () => {
  const title   = $('bc-title').value.trim();
  const message = $('bc-message').value.trim();

  if (!title)   { showToast('Title is required', 'error');   return; }
  if (!message) { showToast('Message is required', 'error'); return; }

  const btn = $('btn-send-broadcast');
  btn.disabled    = true;
  btn.textContent = 'Sending…';

  const r = await api('/api/broadcasts', {
    method: 'POST',
    body:   { title, message, target: bcTarget },
  });

  btn.disabled    = false;
  btn.textContent = 'Send Broadcast';

  if (r._error) { showToast(r._error, 'error'); return; }

  // Success feedback
  const targetLabel = { all:'all users', premium:'premium users', free:'free users' }[bcTarget];
  const feedback = $('sent-feedback');
  feedback.style.display = 'flex';
  feedback.innerHTML = `<div class="sent-to">✅ Sent to ${r.recipientCount} ${targetLabel}</div>`;
  setTimeout(() => { feedback.style.display = 'none'; }, 5000);

  showToast(`Broadcast sent to ${r.recipientCount} ${targetLabel}`, 'success');

  // Clear form
  $('bc-title').value   = '';
  $('bc-message').value = '';
  updatePreview();

  // Refresh history
  loadBroadcasts();
  loadOverview();
});

function deleteBroadcast(id) {
  confirm2('Delete Broadcast', "Remove this broadcast? Users who haven't seen it yet won't see it anymore.", async () => {
    const r = await api(`/api/broadcasts/${id}`, { method:'DELETE' });
    if (r._error) { showToast(r._error, 'error'); return; }
    showToast('Broadcast deleted', 'success');
    loadBroadcasts();
    loadOverview();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function confirm2(title, desc, onConfirm) {
  $('modal-confirm-title').textContent = title;
  $('modal-confirm-desc').textContent  = desc;
  openModal('modal-confirm');
  $('btn-confirm-ok').onclick = () => { closeModal('modal-confirm'); onConfirm(); };
}
$('btn-confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className  = `toast-item ${type}`;
  el.textContent = msg;
  $('toast').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEARCH BINDING
// ═══════════════════════════════════════════════════════════════════════════════
function bindSearch(inputId, handler) {
  const el    = $(inputId);
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  fresh.addEventListener('input', handler);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });
}
function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-NG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SVG ICONS
// ═══════════════════════════════════════════════════════════════════════════════
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">${inner}</svg>`;
const svgSm = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">${inner}</svg>`;

function iconUsers()     { return svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'); }
function iconStar()      { return svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'); }
function iconLink()      { return svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'); }
function iconQR()        { return svg('<rect x="3" y="3" width="5" height="5"/><rect x="16" y="3" width="5" height="5"/><rect x="3" y="16" width="5" height="5"/>'); }
function iconPage()      { return svg('<path d="M4 4h16v16H4z"/><path d="M9 9h6"/><path d="M9 12h6"/><path d="M9 15h4"/>'); }
function iconChart()     { return svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'); }
function iconBroadcast() { return svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.28h3a2 2 0 0 1 2 1.72c.13 1 .38 1.98.74 2.91a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.93.36 1.91.61 2.91.74A2 2 0 0 1 22 16.92z"/>'); }
function iconTrash()     { return svgSm('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>'); }
function iconPlus()      { return svgSm('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'); }
function iconX()         { return svgSm('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'); }

// ── Expose inline onclick handlers ────────────────────────────────────────────
window.openGrantModal  = openGrantModal;
window.revokeUser      = revokeUser;
window.deleteLink      = deleteLink;
window.deleteQR        = deleteQR;
window.deleteBioPage   = deleteBioPage;
window.deleteBroadcast = deleteBroadcast;
