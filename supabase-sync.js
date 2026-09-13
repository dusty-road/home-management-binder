import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://mejbqfkwsabronypsulr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ChLKVj9ET3XSjWsLKhgMFA_Ct_JiVC-';
const BINDER_URL = 'https://dusty-road.github.io/home-management-binder/';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const INTERNAL_PREFIX = '_binder_sync_';
const AUTH_KEY_PREFIX = 'sb-';
let session = null;
let applyingRemote = false;
let readyToPush = false;
let pushTimer = null;
let syncInFlight = false;

const rawSetItem = Storage.prototype.setItem;
const rawRemoveItem = Storage.prototype.removeItem;
const rawClear = Storage.prototype.clear;

function isBinderKey(key) {
  return typeof key === 'string' && !key.startsWith(INTERNAL_PREFIX) && !key.startsWith(AUTH_KEY_PREFIX);
}

function getDirtyKeys() {
  try { return JSON.parse(localStorage.getItem(INTERNAL_PREFIX + 'dirty_keys') || '[]'); }
  catch { return []; }
}

function setDirtyKeys(keys) {
  rawSetItem.call(localStorage, INTERNAL_PREFIX + 'dirty_keys', JSON.stringify([...new Set(keys)]));
}

function markDirty(key) {
  if (!isBinderKey(key) || applyingRemote) return;
  const keys = getDirtyKeys();
  if (!keys.includes(key)) keys.push(key);
  setDirtyKeys(keys);
  schedulePush();
}

Storage.prototype.setItem = function(key, value) {
  rawSetItem.call(this, key, value);
  if (this === localStorage) markDirty(String(key));
};
Storage.prototype.removeItem = function(key) {
  rawRemoveItem.call(this, key);
  if (this === localStorage) markDirty(String(key));
};
Storage.prototype.clear = function() {
  const keys = this === localStorage ? Object.keys(binderSnapshot()) : [];
  rawClear.call(this);
  if (this === localStorage && !applyingRemote) {
    setDirtyKeys(keys);
    schedulePush();
  }
};

function binderSnapshot() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (isBinderKey(key)) data[key] = localStorage.getItem(key);
  }
  return data;
}

function sameData(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    const k = ak[i];
    if (k !== bk[i] || a[k] !== b[k]) return false;
  }
  return true;
}

function applySnapshot(data) {
  applyingRemote = true;
  try {
    const current = binderSnapshot();
    Object.keys(current).forEach(key => {
      if (!(key in data)) rawRemoveItem.call(localStorage, key);
    });
    Object.entries(data).forEach(([key, value]) => rawSetItem.call(localStorage, key, String(value)));
  } finally {
    applyingRemote = false;
  }
}

async function upsertSnapshot(data) {
  if (!session?.user) return false;
  const { error } = await supabase.from('binder_state').upsert(
    { user_id: session.user.id, data },
    { onConflict: 'user_id' }
  );
  if (error) {
    setSyncStatus('Sync problem — tap to retry', true);
    console.error('Binder sync upload failed', error);
    return false;
  }
  setDirtyKeys([]);
  rawSetItem.call(localStorage, INTERNAL_PREFIX + 'initialized', '1');
  setSyncStatus('Synced');
  return true;
}

async function pushSnapshot() {
  if (!readyToPush || !session?.user || applyingRemote || syncInFlight) return;
  syncInFlight = true;
  try { await upsertSnapshot(binderSnapshot()); }
  finally { syncInFlight = false; }
}

function schedulePush() {
  if (!readyToPush || !session?.user || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSnapshot, 650);
}

async function syncFromCloud({ reloadIfChanged = true } = {}) {
  if (!session?.user || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus('Syncing…');
  try {
    const { data: row, error } = await supabase
      .from('binder_state')
      .select('data,updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) throw error;

    const local = binderSnapshot();
    const dirty = getDirtyKeys();
    const initialized = localStorage.getItem(INTERNAL_PREFIX + 'initialized') === '1';

    if (!row) {
      await upsertSnapshot(local);
      return;
    }

    const remote = row.data || {};
    let merged;

    if (!initialized) {
      merged = { ...local, ...remote };
    } else {
      merged = { ...remote };
    }

    dirty.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(local, key)) merged[key] = local[key];
      else delete merged[key];
    });

    const localChanged = !sameData(local, merged);
    const remoteChanged = !sameData(remote, merged);

    if (remoteChanged || dirty.length) {
      const ok = await upsertSnapshot(merged);
      if (!ok) return;
    } else {
      setDirtyKeys([]);
      rawSetItem.call(localStorage, INTERNAL_PREFIX + 'initialized', '1');
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
    setSyncStatus('Sync problem — tap to retry', true);
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
    #binderSyncPanel{display:none;position:absolute;right:0;top:42px;width:min(330px,88vw);background:#fff;border:1px solid #ddd;border-radius:14px;padding:12px;box-shadow:0 12px 32px #0002}
    #binderSyncPanel.open{display:block}
    #binderSyncPanel input{width:100%;padding:10px;border:1px solid #ccc;border-radius:9px;margin:7px 0}
    #binderSyncPanel .sync-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    #binderSyncPanel button{border:0;border-radius:9px;padding:9px 11px;font-weight:800;cursor:pointer;background:#222;color:#fff}
    #binderSyncPanel button.secondary{background:#eee;color:#222}
    #binderSyncStatus{font-size:12px;color:#666;margin-top:7px;line-height:1.35}
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
        <input id="binderSyncEmail" type="email" autocomplete="email" placeholder="Your email address">
        <div class="sync-row"><button id="binderSendLink" type="button">Email me a sign-in link</button></div>
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
  document.getElementById('binderSendLink').addEventListener('click', sendMagicLink);
  document.getElementById('binderSyncNow').addEventListener('click', () => syncFromCloud({ reloadIfChanged: true }));
  document.getElementById('binderSignOut').addEventListener('click', async () => {
    await supabase.auth.signOut();
    session = null;
    readyToPush = false;
    updateAuthUi();
  });
}

function setSyncStatus(text, problem = false) {
  const el = document.getElementById('binderSyncStatus');
  if (el) {
    el.textContent = text || '';
    el.style.color = problem ? '#b42318' : '#666';
  }
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
    setSyncStatus('');
  }
}

async function sendMagicLink() {
  const input = document.getElementById('binderSyncEmail');
  const email = (input?.value || '').trim();
  if (!email) {
    setSyncStatus('Enter your email address first.', true);
    return;
  }
  setSyncStatus('Sending sign-in link…');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: BINDER_URL, shouldCreateUser: true }
  });
  if (error) {
    console.error('Magic-link error', error);
    setSyncStatus(error.message || 'Could not send the sign-in link.', true);
    return;
  }
  setSyncStatus('Email sent. Open the link on this device to sign in.');
}

buildSyncUi();

const { data: initial } = await supabase.auth.getSession();
session = initial.session;
updateAuthUi();
if (session?.user) {
  await syncFromCloud({ reloadIfChanged: true });
  readyToPush = true;
}

supabase.auth.onAuthStateChange(async (event, newSession) => {
  session = newSession;
  updateAuthUi();
  if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
    await syncFromCloud({ reloadIfChanged: true });
    readyToPush = true;
  }
  if (event === 'SIGNED_OUT') readyToPush = false;
});

window.addEventListener('focus', () => {
  if (session?.user) syncFromCloud({ reloadIfChanged: true });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session?.user) syncFromCloud({ reloadIfChanged: true });
});
window.addEventListener('storage', event => {
  if (event.storageArea === localStorage && isBinderKey(event.key || '')) schedulePush();
});
