const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3050;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wrestlemania';
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'wrestler-images');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wwe-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { event: { name: '', cutoff: null }, matches: [], users: {}, results: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Admin access required' });
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get('/api/data', (req, res) => {
  const data = loadData();
  const now = new Date();
  const isAdmin = !!(req.session && req.session.isAdmin);
  const userId = req.session && req.session.userId;

  // Clone data to avoid mutating global object
  const safeData = JSON.parse(JSON.stringify(data));

  // Determine cutoff passed for each event
  const cutoffPassedMap = {};
  (safeData.events || []).forEach(ev => {
    cutoffPassedMap[ev.id] = ev.cutoff && new Date(ev.cutoff) < now;
  });

  // If not admin, hide other users' picks for events where cutoff has NOT passed
  if (!isAdmin) {
    Object.keys(safeData.users).forEach(id => {
      if (id !== userId) {
        const userPicks = safeData.users[id].picks || {};
        const maskedPicks = {};

        // Only keep picks for matches where the event cutoff has passed
        Object.keys(userPicks).forEach(matchId => {
          const match = safeData.matches.find(m => m.id === matchId);
          if (match && match.eventId && cutoffPassedMap[match.eventId]) {
            maskedPicks[matchId] = userPicks[matchId];
          }
        });
        safeData.users[id].picks = maskedPicks;
      }
    });
  }

  res.json({ ...safeData, isAdmin, currentUserId: userId });
});

app.post('/api/users/register', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const data = loadData();
  const id = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (!data.users[id]) {
    data.users[id] = { id, name: name.trim(), picks: {} };
    saveData(data);
  }
  req.session.userId = id;
  res.json({ user: data.users[id] });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const data = loadData();
  if (!data.users[req.params.id]) return res.status(404).json({ error: 'User not found' });
  delete data.users[req.params.id];
  saveData(data);
  res.json({ success: true });
});

app.post('/api/picks', (req, res) => {
  const { userId, picks } = req.body;
  const data = loadData();
  const now = new Date();
  if (data.event.cutoff && new Date(data.event.cutoff) < now) {
    return res.status(403).json({ error: 'Cutoff time has passed' });
  }
  if (!data.users[userId]) return res.status(404).json({ error: 'User not found' });
  data.users[userId].picks = { ...data.users[userId].picks, ...picks };
  saveData(data);
  res.json({ success: true, picks: data.users[userId].picks });
});

app.post('/api/admin/events', requireAdmin, (req, res) => {
  const { name, date, cutoff } = req.body;
  const data = loadData();
  const id = 'event_' + Date.now();
  data.events.push({ id, name, date, cutoff });
  saveData(data);
  res.json({ success: true, event: data.events[data.events.length - 1] });
});

app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const { name, date, cutoff } = req.body;
  const data = loadData();
  const idx = data.events.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  data.events[idx] = { ...data.events[idx], name, date, cutoff };
  saveData(data);
  res.json({ success: true, event: data.events[idx] });
});

app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const data = loadData();
  data.events = data.events.filter(e => e.id !== req.params.id);
  // Also delete matches associated with this event
  data.matches = data.matches.filter(m => m.eventId !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

app.post('/api/admin/matches', requireAdmin, (req, res) => {
  const { title, wrestlers, matchType, eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'Event ID required' });
  const data = loadData();
  const id = 'match_' + Date.now();
  data.matches.push({ id, title, wrestlers, matchType, eventId, order: data.matches.length });
  saveData(data);
  res.json({ success: true, match: data.matches[data.matches.length - 1] });
});

app.put('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const data = loadData();
  const idx = data.matches.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Match not found' });
  data.matches[idx] = { ...data.matches[idx], ...req.body };
  saveData(data);
  res.json({ success: true });
});

app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const data = loadData();
  data.matches = data.matches.filter(m => m.id !== req.params.id);
  delete data.results[req.params.id];
  saveData(data);
  res.json({ success: true });
});

app.post('/api/admin/matches/reorder', requireAdmin, (req, res) => {
  const { order } = req.body;
  const data = loadData();
  const matchMap = {};
  data.matches.forEach(m => { matchMap[m.id] = m; });
  data.matches = order.map(id => matchMap[id]).filter(Boolean);
  saveData(data);
  res.json({ success: true });
});

app.post('/api/admin/results', requireAdmin, (req, res) => {
  const { matchId, winner } = req.body;
  const data = loadData();
  data.results[matchId] = winner;
  saveData(data);
  res.json({ success: true });
});

// Wrestler image proxy - fetches and caches wrestler photos
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

app.post('/api/admin/fetch-image', requireAdmin, async (req, res) => {
  const { wrestlerName, index = 0 } = req.body;
  if (!wrestlerName) return res.status(400).json({ error: 'Name required' });

  const safeName = wrestlerName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  // Check cache first if index is 0
  if (index === 0) {
    const cachedFiles = fs.readdirSync(IMAGES_DIR).filter(f => f.startsWith(safeName + '.'));
    if (cachedFiles.length > 0) {
      return res.json({ success: true, url: `/wrestler-images/${cachedFiles[0]}`, cached: true, index: 0 });
    }
  } else {
    // Delete existing cache to force update
    const files = fs.readdirSync(IMAGES_DIR).filter(f => f.startsWith(safeName + '.'));
    files.forEach(f => { try { fs.unlinkSync(path.join(IMAGES_DIR, f)); } catch(e) {} });
  }

  try {
    // Search Bing Images
    const query = encodeURIComponent(`${wrestlerName} wrestler WWE`);
    const searchUrl = `https://www.bing.com/images/search?q=${query}&form=HDRSC2&first=1`;
    const resPage = await fetchUrl(searchUrl);
    const html = resPage.body.toString();

    // Bing stores image data in m="{"mid":"...","murl":"https://..."}"
    const matches = html.match(/m="\{.*?\}"/g);
    if (!matches || matches.length === 0) {
      return res.json({ success: false, error: 'No images found' });
    }

    const imageUrls = [];
    for (const m of matches) {
      const decoded = m.replace(/&quot;/g, '"');
      try {
        const data = JSON.parse(decoded.substring(3, decoded.length - 1));
        if (data.murl) imageUrls.push(data.murl);
      } catch (e) {}
      if (imageUrls.length >= 20) break;
    }

    if (imageUrls.length === 0) {
      return res.json({ success: false, error: 'No valid image URLs found' });
    }

    // Try images until one downloads successfully, starting from the requested index
    let saved = false;
    for (let i = 0; i < imageUrls.length; i++) {
      const tryIdx = (index + i) % imageUrls.length;
      const imgUrl = imageUrls[tryIdx];
      try {
        const imgRes = await fetchUrl(imgUrl);
        const ct = imgRes.headers['content-type'] || '';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        if (imgRes.body.length < 2000) continue;
        const filename = `${safeName}.${ext}`;
        fs.writeFileSync(path.join(IMAGES_DIR, filename), imgRes.body);
        res.json({ success: true, url: `/wrestler-images/${filename}`, index: tryIdx });
        saved = true;
        break;
      } catch(e) { continue; }
    }
    if (!saved) res.json({ success: false, error: 'Could not download any images' });
  } catch (err) {
    console.error('Image fetch error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/wrestler-image/:name', requireAdmin, (req, res) => {
  const safeName = req.params.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  try {
    const files = fs.readdirSync(IMAGES_DIR).filter(f => f.startsWith(safeName + '.'));
    files.forEach(f => fs.unlinkSync(path.join(IMAGES_DIR, f)));
    res.json({ success: true, deleted: files.length });
  } catch(e) {
    res.json({ success: false });
  }
});

app.listen(PORT, () => console.log(`WWE Predictions running on port ${PORT}`));
