import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://mejbqfkwsabronypsulr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ChLKVj9ET3XSjWsLKhgMFA_Ct_JiVC-';
const BINDER_URL = 'https://dusty-road.github.io/home-management-binder/';
const INTERNAL_PREFIX = 'binderSync:';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

let activeUserId = null;
let suppressPush = false;
let pushTimer = null;
let channel = null;

function isBinderKey(key) {
  return key && !key.startsWith('sb-') && !key.startsWith(INTERNAL_PREFIX);
}

function snapshotBinderState() {
  const state = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!isBinderKey(key)) continue;
    state[key] = localStorage.getItem(key);
  }
  return state;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function applyBinderState(state) {
  suppressPush = true;
  const currentKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (isBinderKey(key)) currentKeys.push(key);
  }
  currentKeys.forEach(key => {
    if (!(key in state)) localStorage.removeItem(key);
  });
  Object.entries(state || {}).forEach(([key, value]) => {
    if (isBinderKey(key)) localStorage.setItem(key, value);
  });
  suppressPush = false;
}

async function pushStateNow() {
  if (!activeUserId || suppressPush) return;
  const data = snapshotBinderState();
  const { error } = await supabase
    .from('binder_state')
    .upsert({ user_id: activeUserId, data }, { onConflict: 'user_id' });
  if (error) console.error('Binder sync upload failed:', error.message);
}

function queuePush() {
  if (!activeUserId || suppressPush) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushStateNow, 700);
}

function installLocalStorageWatcher() {
  if (window.__binderStorageWatcherInstalled) return;
  window.__binderStorageWatcherInstalled = true;

  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  const clear = Storage.prototype.clear;

  Storage.prototype.setItem = function(key, value) {
    const result = setItem.call(this, key, value);
    if (this === localStorage && isBinderKey(String(key))) queuePush();
    return result;
  };

  Storage.prototype.removeItem = function(key) {
    const result = removeItem.call(this, key);
    if (this === localStorage && isBinderKey(String(key))) queuePush();
    return result;
  };

  Storage.prototype.clear = function() {
    const result = clear.call(this);
    if (this === localStorage) queuePush();
    return result;
  };
}

async function ensureInitialState(userId) {
  const { data: row, error } = await supabase
    .from('binder_state')
    .select('data,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!row) {
    const current = snapshotBinderState();
    const { error: insertError } = await supabase
      .from('binder_state')
      .insert({ user_id: userId, data: current });
    if (insertError) throw insertError;
    return;
  }

  const remote = row.data || {};
  const local = snapshotBinderState();
  if (stableStringify(remote) !== stableStringify(local)) {
    applyBinderState(remote);
    sessionStorage.setItem(INTERNAL_PREFIX + 'remoteReload', '1');
    location.reload();
  }
}

function subscribeRealtime(userId) {
  if (channel) supabase.removeChannel(channel);
  channel = supabase
    .channel('binder-state-' + userId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'binder_state',
      filter: `user_id=eq.${userId}`,
    }, payload => {
      if (!payload.new || !payload.new.data) return;
      const remote = payload.new.data;
      const local = snapshotBinderState();
      if (stableStringify(remote) === stableStringify(local)) return;
      applyBinderState(remote);
      sessionStorage.setItem(INTERNAL_PREFIX + 'remoteReload', '1');
      location.reload();
    })
    .subscribe();
}

async function requestMagicLink() {
  const email = prompt('Enter the email address you want to use for Home Management Binder sync:');
  if (!email) return false;

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: BINDER_URL,
    },
  });

  if (error) {
    alert('Could not send the sign-in link. ' + error.message);
    return false;
  }

  alert('Check your email and tap the Home Management Binder sign-in link.');
  return true;
}

async function startBinderSync() {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      await requestMagicLink();
      return;
    }

    activeUserId = session.user.id;
    await ensureInitialState(activeUserId);
    installLocalStorageWatcher();
    subscribeRealtime(activeUserId);

    window.binderSync = {
      status: 'connected',
      email: session.user.email,
      pushNow: pushStateNow,
      signOut: async () => {
        await supabase.auth.signOut();
        location.reload();
      },
    };
  } catch (error) {
    console.error('Binder sync startup failed:', error);
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && !activeUserId) {
    setTimeout(startBinderSync, 0);
  }
});

startBinderSync();
