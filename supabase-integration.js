/* 앳홈 집앞 분리배출 | DB 연동 (Supabase)
   · 앳홈 카케어와 같은 Supabase 프로젝트를 씁니다. 표 이름은 pickup_ 으로 시작합니다.
   · 코드에 넣어도 되는 키는 publishable(공개) 키뿐입니다. 비밀키는 절대 넣지 않습니다.
   · DB_READY 가 false 이거나 주소에 ?demo=1 이 있으면 "미리보기 모드"로 돌아갑니다.
     미리보기 모드는 이 휴대폰 안에만 예시 자료를 저장하고 서버에는 아무것도 보내지 않습니다. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://xejdhnwqqaamujkebvne.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ZMYuEmyPRMc0Q3c2q2Ok3A_vjCYppoE';
  const VAPID_PUBLIC_KEY = 'BM4LZJ-Jr98hfBk0LMrTF4sf2GGiCbrILKTaJLFFsdrGqpEjwtUGb987ihqhy6dsANynnnVBXIkYmrcYujALEdU';
  const PHOTO_BUCKET = 'pickup-photos';

  // database/01 SQL 을 Supabase 에 적용한 뒤 true 로 바꿉니다.
  const DB_READY = false;

  const SESSION_KEY = 'athomePickupSession';
  const params = new URLSearchParams(location.search);
  const DEMO = !DB_READY || params.get('demo') === '1';

  /* ---------- 공통 ---------- */
  function apiError(message, status) { const e = new Error(message); e.status = status; return e; }

  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.access_token ? s : null;
    } catch (_) { return null; }
  }
  function saveSession(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        access_token: s.access_token, refresh_token: s.refresh_token,
        expires_at: Date.now() + Number(s.expires_in || 3600) * 1000
      }));
    } catch (_) {}
  }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} }

  function userIdFromToken(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part)))).sub || null;
    } catch (_) { return null; }
  }

  // 카카오 로그인 후 돌아오면 주소 뒤 #access_token=... 으로 세션이 옵니다.
  let oauthError = '';
  (function captureOAuthReturn() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    if (!/(^|&)(access_token|error)=/.test(raw)) return;
    const q = new URLSearchParams(raw);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    if (q.get('access_token')) {
      saveSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: q.get('expires_in') });
      let back = '';
      try { back = sessionStorage.getItem('pickupAfterLogin') || ''; sessionStorage.removeItem('pickupAfterLogin'); } catch (_) {}
      if (back) location.hash = back;
    } else {
      oauthError = (q.get('error_description') || q.get('error') || '').replace(/\+/g, ' ');
    }
  })();

  async function fetchJson(path, options) {
    options = options || {};
    const r = await fetch(SUPABASE_URL + path, {
      ...options,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const raw = await r.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
    if (!r.ok) {
      const msg = data && (data.message || data.msg || data.error_description || data.error);
      throw apiError(msg || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', r.status);
    }
    return data;
  }

  async function activeToken() {
    const s = readSession();
    if (!s) return null;
    if (Number(s.expires_at) > Date.now() + 60000) return s.access_token;
    if (!s.refresh_token) { clearSession(); return null; }
    try {
      const r = await fetchJson('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token })
      });
      saveSession(r);
      return r.access_token;
    } catch (_) { clearSession(); return null; }
  }

  async function authed(path, options) {
    const token = await activeToken();
    if (!token) throw apiError('로그인이 필요합니다.', 401);
    return fetchJson(path, { ...(options || {}), headers: { Authorization: 'Bearer ' + token, ...((options && options.headers) || {}) } });
  }
  const rpc = (name, body) => authed('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(body || {}) });

  /* ---------- 실제 서버 ---------- */
  const Live = {
    demo: false,
    oauthError: () => oauthError,
    async me() {
      const token = await activeToken();
      return token ? { id: userIdFromToken(token) } : null;
    },
    login(returnHash) {
      try { sessionStorage.setItem('pickupAfterLogin', returnHash || location.hash || ''); } catch (_) {}
      const back = location.origin + location.pathname.replace(/index\.html$/, '');
      location.href = SUPABASE_URL + '/auth/v1/authorize?provider=kakao&scopes=' +
        encodeURIComponent('profile_nickname') + '&redirect_to=' + encodeURIComponent(back);
    },
    async logout() {
      const token = await activeToken();
      clearSession();
      if (token) { try { await fetchJson('/auth/v1/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }); } catch (_) {} }
    },
    async isOwner() { try { return !!(await rpc('is_owner')); } catch (_) { return false; } },

    listComplexes() {
      return fetchJson('/rest/v1/pickup_complexes?select=id,name,region,status,weekdays,start_time,end_time,slot_minutes,drop_note&order=status.asc,name.asc');
    },
    async getComplex(id) {
      const rows = await fetchJson('/rest/v1/pickup_complexes?select=*&id=eq.' + encodeURIComponent(id));
      return rows && rows[0] || null;
    },
    createRequest: (p) => rpc('pickup_create_request', {
      p_complex: p.complexId, p_size: p.size, p_mode: p.mode, p_count: p.count, p_date: p.date, p_slot: p.slot,
      p_dong: p.dong, p_ho: p.ho, p_phone: p.phone, p_memo: p.memo, p_list_price: p.listPrice, p_helper_fee: p.helperFee
    }),
    myRequests: () => authed('/rest/v1/pickup_requests?select=*,pickup_complexes(name)&order=created_at.desc&limit=50'),
    cancelRequest: (id) => rpc('pickup_cancel_request', { p_id: id }),
    async photoUrl(path) {
      const r = await authed('/storage/v1/object/sign/' + PHOTO_BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'),
        { method: 'POST', body: JSON.stringify({ expiresIn: 600 }) });
      return SUPABASE_URL + '/storage/v1' + (r.signedURL || r.signedUrl);
    },

    async helperMe() {
      const rows = await authed('/rest/v1/pickup_helpers?select=*,pickup_complexes(name)');
      return rows && rows[0] || null;
    },
    helperApply: (p) => rpc('pickup_helper_apply', { p_complex: p.complexId, p_name: p.name, p_phone: p.phone, p_dong: p.dong, p_ho: p.ho }),
    openJobs: () => rpc('pickup_open_jobs'),
    acceptJob: (id) => rpc('pickup_accept_job', { p_id: id }),
    myJobs: () => rpc('pickup_my_jobs'),
    releaseJob: (id) => rpc('pickup_release_job', { p_id: id }),
    async uploadPhoto(blob) {
      const me = await Live.me();
      if (!me) throw apiError('로그인이 필요합니다.', 401);
      const path = me.id + '/' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 10) + '.jpg';
      const token = await activeToken();
      const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + PHOTO_BUCKET + '/' + path, {
        method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: blob
      });
      if (!r.ok) throw apiError('사진을 올리지 못했습니다. 다시 시도해 주세요.', r.status);
      return path;
    },
    completeJob: (id, path) => rpc('pickup_complete_job', { p_id: id, p_photo: path }),
    myEarnings: () => rpc('pickup_my_earnings'),

    // 관리자
    adminComplexes: () => authed('/rest/v1/pickup_complexes?select=*&order=name.asc'),
    saveComplex(c) {
      const body = JSON.stringify(c);
      return c.id
        ? authed('/rest/v1/pickup_complexes?id=eq.' + c.id, { method: 'PATCH', body, headers: { Prefer: 'return=minimal' } })
        : authed('/rest/v1/pickup_complexes', { method: 'POST', body, headers: { Prefer: 'return=minimal' } });
    },
    adminRequests: () => authed('/rest/v1/pickup_requests?select=*,pickup_complexes(name),pickup_helpers(name)&order=pickup_date.desc,slot_start.desc&limit=200'),
    adminHelpers: () => authed('/rest/v1/pickup_helpers?select=*,pickup_complexes(name)&order=created_at.desc'),
    setHelperStatus: (id, status) => authed('/rest/v1/pickup_helpers?user_id=eq.' + id, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(status === 'approved' ? { status, verified_at: new Date().toISOString() } : { status })
    }),
    adminSettlement: () => rpc('pickup_admin_settlement'),
    addPayout: (p) => authed('/rest/v1/pickup_payouts', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ helper_id: p.helperId, amount: p.amount, period: p.period || '' }) }),

    // 푸시 (새 일감 / 완료 알림)
    async enablePush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw apiError('이 휴대폰에서는 알림을 받을 수 없어요. 홈 화면에 앱을 추가한 뒤 다시 시도해 주세요.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw apiError('알림이 허용되지 않았어요. 휴대폰 설정에서 알림을 켜 주세요.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const me = await Live.me();
      await authed('/rest/v1/pickup_push_subscriptions?on_conflict=endpoint', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: me.id })
      });
      return true;
    }
  };

  function b64ToBytes(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  /* ---------- 미리보기 모드 (이 휴대폰 안에서만) ---------- */
  const DEMO_KEY = 'athomePickupDemo_v1';
  function seed() {
    const today = new Date();
    const d = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return {
      user: null, owner: true,
      complexes: [
        { id: 'c1', name: '예시 단지 A (시범)', region: '대구 수성구', status: 'open', weekdays: [0,1,2,3,4,5,6], start_time: '19:00:00', end_time: '22:00:00', slot_minutes: 60, daily_limit: 30, drop_note: '현관문 옆, 문이 열리는 쪽 반대편에 두세요.' },
        { id: 'c2', name: '예시 단지 B', region: '대구 수성구', status: 'pending', weekdays: [2,4], start_time: '18:00:00', end_time: '21:00:00', slot_minutes: 60, daily_limit: 30, drop_note: '' },
        { id: 'c3', name: '예시 단지 C', region: '경산', status: 'preparing', weekdays: [1,3,5], start_time: '19:00:00', end_time: '22:00:00', slot_minutes: 60, daily_limit: 30, drop_note: '' }
      ],
      helpers: [{ user_id: 'h-other', complex_id: 'c1', name: '이웃 도우미(예시)', phone: '01000000000', dong: '101', ho: '1201', status: 'approved', created_at: new Date().toISOString() }],
      requests: [
        { id: 'r-s1', complex_id: 'c1', user_id: 'someone', bag_size: 'M', sort_mode: 'sorted', bag_count: 1, pickup_date: d(0), slot_start: '21:00:00', dong: '103', ho: '804', phone: '01011112222', memo: '박스 2개 함께 있어요', list_price: 4500, charge: 0, helper_fee: 3000, status: 'requested', created_at: new Date().toISOString() },
        { id: 'r-s2', complex_id: 'c1', user_id: 'someone2', bag_size: 'S', sort_mode: 'unsorted', bag_count: 2, pickup_date: d(1), slot_start: '20:00:00', dong: '105', ho: '1502', phone: '01033334444', memo: '', list_price: 8000, charge: 0, helper_fee: 4000, status: 'requested', created_at: new Date().toISOString() }
      ],
      payouts: [], photos: {}
    };
  }
  function load() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || seed(); } catch (_) { return seed(); } }
  function save(s) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch (_) {} }
  const wait = (v) => new Promise((res) => setTimeout(() => res(v), 120));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const nameOf = (s, id) => (s.complexes.find((c) => c.id === id) || {}).name || '';
  function needUser(s) { if (!s.user) throw apiError('로그인이 필요합니다.', 401); return s.user; }
  function myHelper(s) { return s.helpers.find((h) => h.user_id === s.user && h.status === 'approved'); }

  const Demo = {
    demo: true,
    oauthError: () => '',
    me: async () => { const s = load(); return s.user ? { id: s.user } : null; },
    login() { const s = load(); s.user = 'demo-user'; save(s); window.dispatchEvent(new Event('hashchange')); },
    async logout() { const s = load(); s.user = null; save(s); },
    isOwner: async () => !!load().user && load().owner,
    reset() { localStorage.removeItem(DEMO_KEY); },

    listComplexes: async () => wait(load().complexes.filter((c) => c.status !== 'closed')),
    getComplex: async (id) => wait(load().complexes.find((c) => c.id === id) || null),
    async createRequest(p) {
      const s = load(); needUser(s);
      const c = s.complexes.find((x) => x.id === p.complexId);
      if (!c || c.status !== 'open') throw apiError('아직 신청을 받지 않는 단지입니다.');
      if (s.requests.filter((r) => r.user_id === s.user && ['requested','accepted'].includes(r.status)).length >= 3)
        throw apiError('진행 중인 신청이 3건 있어요. 완료된 뒤 다시 신청해 주세요.');
      const r = { id: uid(), complex_id: c.id, user_id: s.user, bag_size: p.size, sort_mode: p.mode, bag_count: p.count,
        pickup_date: p.date, slot_start: p.slot + ':00', dong: p.dong, ho: p.ho, phone: p.phone, memo: p.memo || '',
        list_price: p.listPrice, charge: 0, helper_fee: p.helperFee, status: 'requested', created_at: new Date().toISOString() };
      s.requests.unshift(r); save(s); return wait(r.id);
    },
    async myRequests() {
      const s = load(); needUser(s);
      return wait(s.requests.filter((r) => r.user_id === s.user).map((r) => ({ ...r, pickup_complexes: { name: nameOf(s, r.complex_id) } })));
    },
    async cancelRequest(id) {
      const s = load(); const r = s.requests.find((x) => x.id === id && x.user_id === s.user && x.status === 'requested');
      if (r) { r.status = 'cancelled'; save(s); } return wait(!!r);
    },
    photoUrl: async (path) => load().photos[path] || '',

    async helperMe() {
      const s = load(); needUser(s);
      const h = s.helpers.find((x) => x.user_id === s.user);
      return wait(h ? { ...h, pickup_complexes: { name: nameOf(s, h.complex_id) } } : null);
    },
    async helperApply(p) {
      const s = load(); needUser(s);
      s.helpers = s.helpers.filter((h) => h.user_id !== s.user);
      s.helpers.push({ user_id: s.user, complex_id: p.complexId, name: p.name, phone: p.phone, dong: p.dong, ho: p.ho, status: 'pending', created_at: new Date().toISOString() });
      save(s); return wait('pending');
    },
    async openJobs() {
      const s = load(); const h = myHelper(s); if (!h) return [];
      return wait(s.requests.filter((r) => r.complex_id === h.complex_id && r.status === 'requested' && r.user_id !== s.user)
        .map(({ id, bag_size, sort_mode, bag_count, pickup_date, slot_start, dong, helper_fee }) => ({ id, bag_size, sort_mode, bag_count, pickup_date, slot_start, dong, helper_fee })));
    },
    async acceptJob(id) {
      const s = load(); const h = myHelper(s); if (!h) throw apiError('승인된 도우미만 맡을 수 있어요.');
      const r = s.requests.find((x) => x.id === id && x.status === 'requested');
      if (!r) return wait(false);
      Object.assign(r, { status: 'accepted', helper_id: s.user, accepted_at: new Date().toISOString() }); save(s); return wait(true);
    },
    async myJobs() {
      const s = load();
      return wait(s.requests.filter((r) => r.helper_id === s.user && ['accepted','done'].includes(r.status))
        .map((r) => ({ ...r, ho: r.status === 'accepted' ? r.ho : null, memo: r.status === 'accepted' ? r.memo : '' })));
    },
    async releaseJob(id) {
      const s = load(); const r = s.requests.find((x) => x.id === id && x.helper_id === s.user && x.status === 'accepted');
      if (r) { Object.assign(r, { status: 'requested', helper_id: null }); save(s); } return wait(!!r);
    },
    uploadPhoto: (blob) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => { const s = load(); const path = s.user + '/' + uid() + '.jpg'; s.photos[path] = fr.result; save(s); res(path); };
      fr.readAsDataURL(blob);
    }),
    async completeJob(id, path) {
      const s = load(); const r = s.requests.find((x) => x.id === id && x.helper_id === s.user && x.status === 'accepted');
      if (r) { Object.assign(r, { status: 'done', done_at: new Date().toISOString(), photo_path: path }); save(s); } return wait(!!r);
    },
    async myEarnings() {
      const s = load(); const done = s.requests.filter((r) => r.helper_id === s.user && r.status === 'done');
      const pays = s.payouts.filter((p) => p.helper_id === s.user);
      return wait({ doneCount: done.length, earned: done.reduce((a, r) => a + r.helper_fee, 0),
        paid: pays.reduce((a, p) => a + p.amount, 0), payouts: pays.map((p) => ({ amount: p.amount, period: p.period, paidAt: p.paid_at })) });
    },

    adminComplexes: async () => wait(load().complexes),
    async saveComplex(c) {
      const s = load();
      if (c.id) Object.assign(s.complexes.find((x) => x.id === c.id) || {}, c);
      else s.complexes.push({ ...c, id: uid() });
      save(s); return wait(true);
    },
    async adminRequests() {
      const s = load();
      return wait(s.requests.map((r) => ({ ...r, pickup_complexes: { name: nameOf(s, r.complex_id) },
        pickup_helpers: r.helper_id ? { name: (s.helpers.find((h) => h.user_id === r.helper_id) || {}).name || '' } : null })));
    },
    async adminHelpers() { const s = load(); return wait(s.helpers.map((h) => ({ ...h, pickup_complexes: { name: nameOf(s, h.complex_id) } }))); },
    async setHelperStatus(id, status) { const s = load(); const h = s.helpers.find((x) => x.user_id === id); if (h) { h.status = status; save(s); } return wait(true); },
    async adminSettlement() {
      const s = load();
      return wait(s.helpers.map((h) => {
        const done = s.requests.filter((r) => r.helper_id === h.user_id && r.status === 'done');
        return { helper_id: h.user_id, name: h.name, done_count: done.length, earned: done.reduce((a, r) => a + r.helper_fee, 0),
          paid: s.payouts.filter((p) => p.helper_id === h.user_id).reduce((a, p) => a + p.amount, 0) };
      }));
    },
    async addPayout(p) { const s = load(); s.payouts.push({ helper_id: p.helperId, amount: p.amount, period: p.period, paid_at: new Date().toISOString() }); save(s); return wait(true); },
    enablePush: async () => { throw apiError('미리보기 모드에서는 알림을 보내지 않아요. 실제 운영 때 켜집니다.'); }
  };

  window.PickupAPI = DEMO ? Demo : Live;
})();
