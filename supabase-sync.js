const SUPABASE_URL = 'https://mejbqfkwsabronypsulr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ChLKVj9ET3XSjWsLKhgMFA_Ct_JiVC-';
const BINDER_URL = 'https://dusty-road.github.io/home-management-binder/';

const INTERNAL_PREFIX = '_binder_sync_';
const SESSION_KEY = INTERNAL_PREFIX + 'session';
const INITIALIZED_KEY = INTERNAL_PREFIX + 'initialized';
const DIRTY_KEY = INTERNAL_PREFIX + 'dirty_keys';

// Only binder data is synced. This avoids copying localStorage from other
// dusty-road.github.io projects that share the same browser origin.
const BINDER_KEYS = new Set([
  'needsAttentionItems','comingUpItems','birthdays','homeInventory','parentPin',
  'zoneIndex','zoneChecks','groceries','cleanItems','costcoItems','weeklyMeals',
  'weeklyMealRecipeLinks','prepTasks','batchTasks','recipes',
  'jamesChores','graceChores','jamesVerifiedDate','graceVerifiedDate',
  'jamesApprovedDays','graceApprovedDays','jamesRewards','graceRewards',
  'jamesExtraJobs','graceExtraJobs'
]);

let session = null;
let applyingRemote = false;
let readyToPush = false;
let pushTimer = null;
let syncInFlight = false;

const rawSetItem = Storage.prototype.setItem;
const rawRemoveItem = Storage.prototype.removeItem;

// Parent chore verification PIN migration: replace the old default with 9999.
const existingParentPin = localStorage.getItem('parentPin');
if (existingParentPin === null || existingParentPin === '1234') {
  rawSetItem.call(localStorage, 'parentPin', '9999');
}

function isBinderKey(key) { return BINDER_KEYS.has(String(key)); }
function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
  catch { return fallback; }
}
function saveInternal(key, value) { rawSetItem.call(localStorage, key, value); }
function removeInternal(key) { rawRemoveItem.call(localStorage, key); }

function getDirtyKeys() {
  const value = readJson(DIRTY_KEY, []);
  return Array.isArray(value) ? value.filter(isBinderKey) : [];
}
function setDirtyKeys(keys) {
  saveInternal(DIRTY_KEY, JSON.stringify([...new Set(keys.filter(isBinderKey))]));
}
function markDirty(key) {
  key = String(key);
  if (!isBinderKey(key) || applyingRemote) return;
  const keys = getDirtyKeys();
  if (!keys.includes(key)) keys.push(key);
  setDirtyKeys(keys);
  schedulePush();
}

Storage.prototype.setItem = function(key, value) {
  rawSetItem.call(this, key, value);
  if (this === localStorage) markDirty(key);
};
Storage.prototype.removeItem = function(key) {
  rawRemoveItem.call(this, key);
  if (this === localStorage) markDirty(key);
};

function binderSnapshot() {
  const data = {};
  BINDER_KEYS.forEach(key => {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  });
  return data;
}

function sameData(a = {}, b = {}) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.every(k => a[k] === b[k]);
}

function applySnapshot(data = {}) {
  applyingRemote = true;
  try {
    BINDER_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(data, key)) rawSetItem.call(localStorage, key, String(data[key]));
      else rawRemoveItem.call(localStorage, key);
    });
  } finally {
    applyingRemote = false;
  }
}

function authHeaders(token) {
  const headers = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function authRequest(path, body, token) {
  const response = await fetch(SUPABASE_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers: authHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return parseResponse(response);
}

function normalizeSession(data) {
  if (!data?.access_token) return null;
  const expiresAt = Number(data.expires_at || 0) || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: expiresAt,
    user: data.user || null
  };
}

function persistSession(value) {
  session = value;
  if (value) saveInternal(SESSION_KEY, JSON.stringify(value));
  else removeInternal(SESSION_KEY);
  updateAuthUi();
}

async function getUser(accessToken) {
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: authHeaders(accessToken) });
  return parseResponse(response);
}

async function refreshSession() {
  if (!session?.refresh_token) return false;
  try {
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    const fresh = normalizeSession(data);
    if (!fresh) throw new Error('Could not refresh session');
    if (!fresh.user) fresh.user = await getUser(fresh.access_token);
    persistSession(fresh);
    return true;
  } catch (err) {
    console.error('Binder sync session refresh failed', err);
    persistSession(null);
    readyToPush = false;
    setSyncStatus('Please sign in again.', true);
    return false;
  }
}

async function ensureSession() {
  if (!session) session = readJson(SESSION_KEY, null);
  if (!session?.access_token) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(session.expires_at || 0) <= now + 60) return refreshSession();
  if (!session.user?.id) {
    try {
      session.user = await getUser(session.access_token);
      persistSession(session);
    } catch {
      return refreshSession();
    }
  }
  return !!session?.user?.id;
}

async function restRequest(path, options = {}, retry = true) {
  if (!(await ensureSession())) throw new Error('Not signed in');
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if ((response.status === 401 || response.status === 403) && retry && await refreshSession()) {
    return restRequest(path, options, false);
  }
  return parseResponse(response);
}

async function upsertSnapshot(data) {
  if (!(await ensureSession())) return false;
  try {
    await restRequest('binder_state?on_conflict=user_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: session.user.id, data, updated_at: new Date().toISOString() })
    });
    setDirtyKeys([]);
    saveInternal(INITIALIZED_KEY, '1');
    setSyncStatus('Synced');
    return true;
  } catch (err) {
    console.error('Binder sync upload failed', err);
    setSyncStatus('Sync problem — tap Sync now to retry.', true);
    return false;
  }
}

async function pushSnapshot() {
  if (!readyToPush || applyingRemote || syncInFlight) return;
  syncInFlight = true;
  try { await upsertSnapshot(binderSnapshot()); }
  finally { syncInFlight = false; }
}
function schedulePush() {
  if (!readyToPush || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSnapshot, 650);
}

async function syncFromCloud({ reloadIfChanged = true } = {}) {
  if (syncInFlight || !(await ensureSession())) return;
  syncInFlight = true;
  setSyncStatus('Syncing…');
  try {
    const rows = await restRequest(`binder_state?select=data,updated_at&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { method: 'GET' });
    const row = Array.isArray(rows) ? rows[0] : null;
    const local = binderSnapshot();
    const dirty = getDirtyKeys();
    const initialized = localStorage.getItem(INITIALIZED_KEY) === '1';

    // First connected device seeds Supabase with its existing browser data.
    if (!row) {
      await upsertSnapshot(local);
      return;
    }

    const remote = row.data && typeof row.data === 'object' ? row.data : {};
    let merged = initialized ? { ...remote } : { ...local, ...remote };

    // Keep every device and the cloud on the new parent PIN.
    if (!merged.parentPin || merged.parentPin === '1234') merged.parentPin = '9999';

    // Unsaved edits on this device always survive a pull.
    dirty.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(local, key)) merged[key] = local[key];
      else delete merged[key];
    });

    const localChanged = !sameData(local, merged);
    const remoteChanged = !sameData(remote, merged);

    if (remoteChanged || dirty.length) {
      if (!(await upsertSnapshot(merged))) return;
    } else {
      setDirtyKeys([]);
      saveInternal(INITIALIZED_KEY, '1');
    }

    if (localChanged) {
      applySnapshot(merged);
      setSyncStatus('Synced');
      if (reloadIfChanged) location.reload();
    } else {
      setSyncStatus('Synced');
    }
  } catch (err) {
    console.error('Binder sync download failed', err);
    setSyncStatus('Sync problem — tap Sync now to retry.', true);
  } finally {
    syncInFlight = false;
  }
}

function buildSyncUi() {
  if (document.getElementById('binderSyncBox')) return;
  const style = document.createElement('style');
  style.textContent = `
    #binderSyncBox{position:absolute;right:22px;top:18px;z-index:80;font-family:Arial,sans-serif}
    #binderSyncButton{border:0;border-radius:999px;padding:8px 12px;font-weight:800;cursor:pointer;background:#eef4ff;color:#222;box-shadow:0 2px 8px #0001}
    #binderSyncPanel{display:none;position:absolute;right:0;top:42px;width:min(350px,90vw);background:#fff;border:1px solid #ddd;border-radius:14px;padding:12px;box-shadow:0 12px 32px #0002}
    #binderSyncPanel.open{display:block}
    #binderSyncPanel input{width:100%;padding:10px;border:1px solid #ccc;border-radius:9px;margin:7px 0}
    #binderSyncPanel .sync-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    #binderSyncPanel button{border:0;border-radius:9px;padding:9px 11px;font-weight:800;cursor:pointer;background:#222;color:#fff}
    #binderSyncPanel button.secondary{background:#eee;color:#222}
    #binderSyncStatus{font-size:12px;color:#666;margin-top:8px;line-height:1.35}
    #binderSyncHint{font-size:11px;color:#777;margin-top:7px;line-height:1.35}
    @media(max-width:650px){#binderSyncBox{position:static;margin-top:9px}#binderSyncPanel{left:0;right:auto;top:auto;margin-top:7px}}
  `;
  document.head.appendChild(style);
  const header = document.querySelector('header');
  if (!header) return;
  header.style.position = 'relative';
  const box = document.createElement('div');
  box.id = 'binderSyncBox';
  box.innerHTML = `
    <button id="binderSyncButton" type="button">☁ Sign in to sync</button>
    <div id="binderSyncPanel">
      <div id="binderSignedOut">
        <strong>Sync across devices</strong>
        <input id="binderSyncEmail" type="email" autocomplete="email" placeholder="Email address">
        <input id="binderSyncPassword" type="password" autocomplete="current-password" placeholder="Password (6+ characters)">
        <div class="sync-row"><button id="binderSignIn" type="button">Sign in</button><button id="binderCreateAccount" class="secondary" type="button">Create sync account</button></div>
        <div id="binderSyncHint">Use the same account on every device.</div>
      </div>
      <div id="binderSignedIn" style="display:none">
        <strong id="binderSignedInEmail"></strong>
        <div class="sync-row" style="margin-top:8px"><button id="binderSyncNow" type="button">Sync now</button><button id="binderSignOut" class="secondary" type="button">Sign out</button></div>
      </div>
      <div id="binderSyncStatus"></div>
    </div>`;
  header.appendChild(box);

  const btn = document.getElementById('binderSyncButton');
  const panel = document.getElementById('binderSyncPanel');
  btn.addEventListener('click', () => panel.classList.toggle('open'));
  document.getElementById('binderSignIn').addEventListener('click', signInWithPassword);
  document.getElementById('binderCreateAccount').addEventListener('click', createSyncAccount);
  document.getElementById('binderSyncNow').addEventListener('click', () => syncFromCloud({ reloadIfChanged: true }));
  document.getElementById('binderSignOut').addEventListener('click', signOut);
  document.getElementById('binderSyncPassword').addEventListener('keydown', e => { if (e.key === 'Enter') signInWithPassword(); });
}

function setSyncStatus(text, problem = false) {
  const el = document.getElementById('binderSyncStatus');
  if (el) { el.textContent = text || ''; el.style.color = problem ? '#b42318' : '#666'; }
  const btn = document.getElementById('binderSyncButton');
  if (btn && session?.user && text === 'Synced') btn.textContent = '☁ Synced';
}

function updateAuthUi() {
  const out = document.getElementById('binderSignedOut');
  const inn = document.getElementById('binderSignedIn');
  const btn = document.getElementById('binderSyncButton');
  if (!out || !inn || !btn) return;
  if (session?.user) {
    out.style.display = 'none';
    inn.style.display = '';
    document.getElementById('binderSignedInEmail').textContent = session.user.email || 'Signed in';
    btn.textContent = '☁ Sync';
  } else {
    out.style.display = '';
    inn.style.display = 'none';
    btn.textContent = '☁ Sign in to sync';
  }
}

function credentials() {
  const email = (document.getElementById('binderSyncEmail')?.value || '').trim();
  const password = document.getElementById('binderSyncPassword')?.value || '';
  if (!email) throw new Error('Enter your email address.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  return { email, password };
}

async function finishAuth(data) {
  const next = normalizeSession(data);
  if (!next) return false;
  if (!next.user) next.user = await getUser(next.access_token);
  persistSession(next);
  setSyncStatus('Connected. Syncing this binder…');
  await syncFromCloud({ reloadIfChanged: true });
  readyToPush = true;
  return true;
}

async function signInWithPassword() {
  try {
    const { email, password } = credentials();
    setSyncStatus('Signing in…');
    const data = await authRequest('token?grant_type=password', { email, password });
    if (!(await finishAuth(data))) throw new Error('Sign-in did not return a session.');
  } catch (err) {
    console.error('Binder sync sign-in failed', err);
    setSyncStatus(err.message || 'Could not sign in.', true);
  }
}

async function createSyncAccount() {
  try {
    const { email, password } = credentials();
    setSyncStatus('Creating sync account…');
    const redirect = encodeURIComponent(BINDER_URL);
    const data = await authRequest(`signup?redirect_to=${redirect}`, { email, password });
    if (await finishAuth(data)) return;
    setSyncStatus('Account created. Check your email to confirm it, then return here and tap Sign in.');
  } catch (err) {
    console.error('Binder sync account creation failed', err);
    setSyncStatus(err.message || 'Could not create the sync account.', true);
  }
}

async function signOut() {
  try {
    if (session?.access_token) await authRequest('logout', undefined, session.access_token);
  } catch (err) {
    console.warn('Supabase sign-out request failed', err);
  }
  persistSession(null);
  readyToPush = false;
  setSyncStatus('Signed out. Your binder data is still stored on this device.');
}

async function consumeAuthHash() {
  if (!location.hash || !location.hash.includes('access_token=')) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token') || '';
  if (!accessToken) return false;
  try {
    const user = await getUser(accessToken);
    const expiresAt = Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600);
    persistSession({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch (err) {
    console.error('Could not finish email confirmation', err);
    setSyncStatus('Email confirmed, but sign-in needs to be completed manually.', true);
    return false;
  }
}

buildSyncUi();
session = readJson(SESSION_KEY, null);
updateAuthUi();
await consumeAuthHash();

if (await ensureSession()) {
  updateAuthUi();
  await syncFromCloud({ reloadIfChanged: true });
  readyToPush = true;
} else {
  persistSession(null);
}

window.addEventListener('focus', () => {
  if (session?.user && !pushTimer) syncFromCloud({ reloadIfChanged: true });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session?.user && !pushTimer) syncFromCloud({ reloadIfChanged: true });
});
window.addEventListener('storage', event => {
  if (event.storageArea === localStorage && isBinderKey(event.key || '')) schedulePush();
});