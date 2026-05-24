'use strict';
const express = require('express');
const path    = require('path');
const admin   = require('firebase-admin');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Firebase Admin ─────────────────────────────────────────────────────────────
try {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  admin.initializeApp({
    credential: svc
      ? admin.credential.cert(svc)
      : admin.credential.applicationDefault(),
  });
  console.log('✅ Firebase Admin ready');
} catch (e) {
  console.error('❌ Firebase init failed:', e.message);
  process.exit(1);
}

const db  = admin.firestore();
const FV  = admin.firestore.FieldValue;
const TS  = admin.firestore.Timestamp;

// ── Core Middleware ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ── Admin Auth Middleware ──────────────────────────────────────────────────────
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '')
  .split(',').map(u => u.trim()).filter(Boolean);

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(token);
    if (!ADMIN_UIDS.includes(decoded.uid)) {
      console.log('❌ Rejected UID:', JSON.stringify(decoded.uid), '| Allowed:', JSON.stringify(ADMIN_UIDS));
      return res.status(403).json({ error: 'Not an admin' });
    }
    req.adminUid   = decoded.uid;
    req.adminEmail = decoded.email || 'admin';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────
async function fetchCol(collection, orderField = 'createdAt', lim = 300) {
  try {
    const snap = await db.collection(collection)
      .orderBy(orderField, 'desc').limit(lim).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await db.collection(collection).limit(lim).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

function ts(field) {
  if (!field) return null;
  if (typeof field.toMillis === 'function') return field.toMillis();
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const [uSnap, lSnap, qSnap, bSnap, brSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('shortlinks').get(),
      db.collection('dynamicqr').get(),
      db.collection('biopages').get(),
      db.collection('broadcasts').get(),
    ]);

    const now = Date.now();
    let premium = 0, expired = 0, totalClicks = 0, totalScans = 0;

    uSnap.docs.forEach(doc => {
      const d = doc.data();
      if (d.plan === 'premium') {
        const exp = ts(d.premiumExpiresAt) || 0;
        exp > now ? premium++ : expired++;
      }
    });
    lSnap.docs.forEach(doc => { totalClicks += (doc.data().clicks || 0); });
    qSnap.docs.forEach(doc => { totalScans  += (doc.data().scans  || 0); });

    res.json({
      users:      { total: uSnap.size, premium, expired, free: uSnap.size - premium - expired },
      content:    { shortlinks: lSnap.size, qrcodes: qSnap.size, biopages: bSnap.size },
      engagement: { totalClicks, totalScans },
      broadcasts: brSnap.size,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const rows = await fetchCol('users', 'createdAt');
    const users = rows.map(d => ({
      uid:              d.id,
      email:            d.email        || '—',
      displayName:      d.displayName  || d.name || '—',
      plan:             d.plan         || 'free',
      premiumExpiresAt: ts(d.premiumExpiresAt),
      premiumStartedAt: ts(d.premiumStartedAt),
      paystackRef:      d.paystackRef  || null,
      grantedByAdmin:   d.grantedByAdmin || false,
      createdAt:        ts(d.createdAt),
    }));
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:uid/grant-premium', requireAdmin, async (req, res) => {
  try {
    const days    = Math.max(1, parseInt(req.body.days) || 30);
    const expires = new Date(Date.now() + days * 86_400_000);
    await db.collection('users').doc(req.params.uid).update({
      plan:              'premium',
      premiumExpiresAt:  TS.fromDate(expires),
      premiumStartedAt:  FV.serverTimestamp(),
      grantedByAdmin:    true,
      grantedByAdminAt:  FV.serverTimestamp(),
      grantedByAdminUid: req.adminUid,
    });
    res.json({ success: true, expiresAt: expires.toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:uid/revoke-premium', requireAdmin, async (req, res) => {
  try {
    await db.collection('users').doc(req.params.uid).update({
      plan:              'free',
      premiumExpiresAt:  TS.fromDate(new Date(0)),
      revokedByAdmin:    true,
      revokedAt:         FV.serverTimestamp(),
      revokedByAdminUid: req.adminUid,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SHORT LINKS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/links', requireAdmin, async (req, res) => {
  try {
    const rows  = await fetchCol('shortlinks', 'createdAt');
    const links = rows.map(d => ({
      code:        d.id,
      destination: d.destination || d.longUrl || '—',
      userId:      d.userId      || '—',
      clicks:      d.clicks      || 0,
      alias:       d.alias       || null,
      hasPassword: !!d.password,
      scheduledAt: ts(d.scheduledAt),
      expiresAt:   ts(d.expiresAt),
      createdAt:   ts(d.createdAt),
    }));
    res.json({ links });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/links/:code', requireAdmin, async (req, res) => {
  try {
    await db.collection('shortlinks').doc(req.params.code).delete();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  QR CODES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/qrcodes', requireAdmin, async (req, res) => {
  try {
    const rows    = await fetchCol('dynamicqr', 'createdAt');
    const qrcodes = rows.map(d => ({
      code:        d.id,
      destination: d.destination || '—',
      userId:      d.userId      || '—',
      label:       d.label       || null,
      scans:       d.scans       || 0,
      createdAt:   ts(d.createdAt),
    }));
    res.json({ qrcodes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/qrcodes/:code', requireAdmin, async (req, res) => {
  try {
    await db.collection('dynamicqr').doc(req.params.code).delete();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BIO PAGES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/biopages', requireAdmin, async (req, res) => {
  try {
    const rows  = await fetchCol('biopages', 'createdAt');
    const pages = rows.map(d => ({
      username:  d.id,
      userId:    d.userId || '—',
      title:     d.title  || '—',
      linkCount: Array.isArray(d.links) ? d.links.length : 0,
      createdAt: ts(d.createdAt),
    }));
    res.json({ pages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/biopages/:username', requireAdmin, async (req, res) => {
  try {
    await db.collection('biopages').doc(req.params.username).delete();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/payments', requireAdmin, async (req, res) => {
  try {
    let snap;
    try {
      snap = await db.collection('users')
        .where('paystackRef', '!=', null)
        .orderBy('paystackRef').orderBy('premiumStartedAt', 'desc')
        .limit(300).get();
    } catch {
      snap = await db.collection('users').limit(300).get();
    }
    const payments = snap.docs
      .filter(doc => doc.data().paystackRef)
      .map(doc => {
        const d = doc.data();
        return {
          uid:              doc.id,
          email:            d.email       || '—',
          paystackRef:      d.paystackRef,
          grantedByAdmin:   d.grantedByAdmin || false,
          premiumStartedAt: ts(d.premiumStartedAt),
          premiumExpiresAt: ts(d.premiumExpiresAt),
        };
      });
    res.json({ payments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BROADCASTS
// ═══════════════════════════════════════════════════════════════════════════════

// List all broadcasts
app.get('/api/broadcasts', requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('broadcasts')
      .orderBy('createdAt', 'desc').limit(100).get();
    const broadcasts = snap.docs.map(d => {
      const data = d.data();
      return {
        id:           d.id,
        title:        data.title        || '',
        message:      data.message      || '',
        target:       data.target       || 'all',
        sentByEmail:  data.sentByEmail  || 'admin',
        createdAt:    ts(data.createdAt),
      };
    });
    res.json({ broadcasts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send a broadcast
app.post('/api/broadcasts', requireAdmin, async (req, res) => {
  try {
    const { title, message, target } = req.body;

    if (!title?.trim())   return res.status(400).json({ error: 'Title is required' });
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!['all', 'premium', 'free'].includes(target))
      return res.status(400).json({ error: 'Invalid target. Use all | premium | free' });

    // Count recipients for response info
    const usersSnap = await db.collection('users').get();
    const now       = Date.now();
    let recipientCount = 0;

    usersSnap.docs.forEach(doc => {
      const d   = doc.data();
      const exp = ts(d.premiumExpiresAt) || 0;
      const isPremium = d.plan === 'premium' && exp > now;

      if (target === 'all')     recipientCount++;
      if (target === 'premium' && isPremium)  recipientCount++;
      if (target === 'free'    && !isPremium) recipientCount++;
    });

    const ref = await db.collection('broadcasts').add({
      title:       title.trim(),
      message:     message.trim(),
      target,
      sentByUid:   req.adminUid,
      sentByEmail: req.adminEmail,
      createdAt:   FV.serverTimestamp(),
    });

    res.json({ success: true, id: ref.id, recipientCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a broadcast
app.delete('/api/broadcasts/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('broadcasts').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Catch-all → admin.html ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () =>
  console.log(`🛡️  Trisend Admin running → http://localhost:${PORT}`)
);
