/* 앳홈 집앞 분리배출 | 화면 이동과 각 화면
   주소 뒤 #/ 로 화면을 나눕니다.
   #/ 홈(단지 검색) · #/c/단지id 신청 · #/my 내 신청 · #/helper 도우미 · #/admin 관리 */
(function () {
  'use strict';
  const API = window.PickupAPI;
  const P = window.PICKUP_PRICES;
  const view = document.getElementById('view');
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS_COMPLEX = { open: ['이용 가능', 'ok'], pending: ['승인 대기', 'wait'], preparing: ['준비 중', 'off'], closed: ['숨김', 'off'] };
  const STATUS_REQ = { requested: ['접수됨', 'wait'], accepted: ['도우미 배정', 'info'], done: ['배출 완료', 'ok'], cancelled: ['취소', 'off'] };
  const STATUS_HELPER = { pending: ['확인 중', 'wait'], approved: ['승인', 'ok'], suspended: ['중지', 'off'], rejected: ['반려', 'off'] };

  let complexesCache = null;
  let helperTab = 'open';
  let adminTab = 'requests';

  /* ---------- 작은 도구 ---------- */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const badge = (map, key) => { const m = map[key] || [key, 'off']; return `<span class="badge ${m[1]}">${esc(m[0])}</span>`; };
  const hhmm = (t) => String(t || '').slice(0, 5);
  const bagText = (r) => `${P.bags[r.bag_size] ? P.bags[r.bag_size].label : r.bag_size} ${r.bag_count || 1}개 · ${(P.modes[r.sort_mode] || {}).label || ''}`;
  function seoulToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); }
  function seoulNowTime() { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
  function dateLabel(iso) { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}(${WEEK[dow(iso)]})`; }
  function daysText(arr) { return (arr || []).length === 7 ? '매일' : (arr || []).slice().sort().map((d) => WEEK[d]).join('·') || '미정'; }
  function toMin(t) { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; }
  function fromMin(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }

  function slotsFor(c, date) {
    const out = []; const step = Number(c.slot_minutes) || 60;
    const isToday = date === seoulToday(); const now = toMin(seoulNowTime());
    for (let t = toMin(c.start_time); t < toMin(c.end_time); t += step) {
      if (isToday && t <= now) continue;
      out.push({ value: fromMin(t), label: `${fromMin(t)}~${fromMin(Math.min(t + step, toMin(c.end_time)))}` });
    }
    return out;
  }
  function datesFor(c) {
    const out = []; const today = seoulToday();
    for (let i = 0; i <= 14; i++) {
      const d = addDays(today, i);
      if ((c.weekdays || []).includes(dow(d)) && slotsFor(c, d).length) out.push(d);
    }
    return out;
  }

  function notice(msg, isError) {
    const n = document.getElementById('notice');
    n.textContent = msg; n.className = 'notice' + (isError ? ' error' : '');
    clearTimeout(notice.t); notice.t = setTimeout(() => n.classList.add('hidden'), 4500);
  }
  function errText(e) {
    if (e && e.status === 401) return '로그인이 필요해요. 카카오로 다시 로그인해 주세요.';
    return (e && e.message) || '잠시 후 다시 시도해 주세요.';
  }
  function setView(html) { view.innerHTML = html; view.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  function loading() { setView('<div class="loading">불러오는 중…</div>'); }
  function loginCard(title, desc) {
    return `<section class="card login-card">
      <h2>${esc(title)}</h2><p class="muted">${esc(desc)}</p>
      <button class="kakao-btn" data-act="login" type="button">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#191919" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.8 5.3 4.6 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1.1.1 1.6.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>
        카카오로 로그인</button>
      <p class="tiny muted">앳홈 카케어 회원이면 같은 카카오 계정으로 그대로 이용할 수 있어요.</p>
    </section>`;
  }
  const ACCEPT_LIST = ['종이·박스', '플라스틱', '캔·고철', '유리병', '비닐'];
  const REJECT_LIST = ['음식물', '종량제 봉투', '대형폐기물', '가전제품', '위험물(건전지·약품 등)', '의류'];

  /* ---------- 홈: 단지 검색 ---------- */
  async function renderHome() {
    setView(`
      <section class="hero">
        <p class="eyebrow">대구·경산 아파트 시범 서비스</p>
        <h1>문 앞에 두면,<br>이웃이 대신 내놓아요</h1>
        <p>재활용품을 문 앞에 두기만 하세요. 같은 단지에 사는 도우미가 단지 분리수거장에 규칙대로 분리배출해 드려요.</p>
        ${P.freePilot ? '<div class="pilot">지금은 <b>무료 시범 기간</b>이에요. 이용료를 받지 않아요.</div>' : ''}
      </section>

      <section class="section">
        <h2>우리 단지 찾기</h2>
        <input id="search" class="search" type="search" placeholder="아파트 이름으로 검색" autocomplete="off" />
        <div id="complexList" class="list"><div class="loading">불러오는 중…</div></div>
        <p class="tiny muted">관리사무소 승인을 받은 단지에서만 신청을 받아요. 우리 단지를 추천하고 싶으면 카카오 채널로 알려 주세요.</p>
      </section>

      <section class="section">
        <h2>이용 방법</h2>
        <ol class="steps">
          <li><b>단지 고르기</b><span>이용 가능한 단지인지 확인해요.</span></li>
          <li><b>봉투 크기와 시간 고르기</b><span>단지 배출 요일·시간 안에서만 골라요.</span></li>
          <li><b>문 앞에 두기</b><span>고른 시간 전까지 문 앞에 내놓아요.</span></li>
          <li><b>완료 알림 받기</b><span>도우미가 분리수거장에 배출하고 사진을 보내요.</span></li>
        </ol>
      </section>

      <section class="section two">
        <div class="card ok-card"><h3>받는 것</h3><ul>${ACCEPT_LIST.map((x) => `<li>${x}</li>`).join('')}</ul></div>
        <div class="card no-card"><h3>받지 않는 것</h3><ul>${REJECT_LIST.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      </section>

      <section class="section">
        <a class="card recruit" href="#/helper">
          <b>🙋 우리 단지 도우미가 되어 주세요</b>
          <span>같은 단지에 사는 분만 할 수 있어요. 퇴근길·산책길에 이웃 재활용품을 함께 내놓고 수고비를 받아요.</span>
        </a>
      </section>`);

    const list = document.getElementById('complexList');
    const search = document.getElementById('search');
    try { complexesCache = await API.listComplexes(); }
    catch (e) { list.innerHTML = `<div class="empty">단지 목록을 불러오지 못했어요. ${esc(errText(e))}</div>`; return; }
    const draw = () => {
      const q = search.value.trim().replace(/\s/g, '');
      const rows = complexesCache.filter((c) => !q || (c.name + c.region).replace(/\s/g, '').includes(q));
      list.innerHTML = rows.length ? rows.map((c) => `
        <a class="row" href="#/c/${esc(c.id)}">
          <div><b>${esc(c.name)}</b><small>${esc(c.region)}${c.status === 'open' ? ' · ' + daysText(c.weekdays) + ' ' + hhmm(c.start_time) + '~' + hhmm(c.end_time) : ''}</small></div>
          ${badge(STATUS_COMPLEX, c.status)}
        </a>`).join('') : '<div class="empty">찾는 단지가 없어요. 아직 준비 중인 단지일 수 있어요.</div>';
    };
    search.addEventListener('input', draw);
    draw();
  }

  /* ---------- 단지 상세 + 신청 ---------- */
  async function renderComplex(id) {
    loading();
    let c, me;
    try { [c, me] = await Promise.all([API.getComplex(id), API.me()]); }
    catch (e) { setView(`<div class="empty">${esc(errText(e))}</div>`); return; }
    if (!c) { setView('<div class="empty">단지를 찾을 수 없어요. <a href="#/">처음으로</a></div>'); return; }

    const head = `<section class="page-head">
      <a class="back" href="#/">‹ 단지 목록</a>
      <h1>${esc(c.name)} ${badge(STATUS_COMPLEX, c.status)}</h1>
      <p class="muted">${esc(c.region)} · 배출 ${daysText(c.weekdays)} ${hhmm(c.start_time)}~${hhmm(c.end_time)}</p>
    </section>`;

    if (c.status !== 'open') {
      const msg = c.status === 'pending'
        ? '관리사무소와 협의하고 있어요. 승인이 나면 바로 신청을 열게요.'
        : '아직 준비 중인 단지예요. 이웃이 많이 원하면 더 빨리 열 수 있어요.';
      setView(head + `<section class="section"><div class="card"><p>${msg}</p>
        <p class="muted tiny">이 단지에 사신다면 도우미로 먼저 신청해 두셔도 좋아요.</p>
        <a class="btn ghost" href="#/helper">도우미 신청하기</a></div></section>`);
      return;
    }
    if (!me) { setView(head + `<section class="section">${loginCard('로그인하고 신청하기', '신청 내역과 완료 알림을 받으려면 로그인이 필요해요.')}</section>`); return; }

    const dates = datesFor(c);
    const sizeCards = Object.entries(P.bags).map(([k, b], i) => `
      <label class="choice"><input type="radio" name="size" value="${k}" ${i === 0 ? 'checked' : ''} />
        <span><b>${b.label}</b><small>${esc(b.hint)}</small><em data-price="${k}"></em></span></label>`).join('');
    const modeCards = Object.entries(P.modes).map(([k, m], i) => `
      <label class="choice"><input type="radio" name="mode" value="${k}" ${i === 0 ? 'checked' : ''} />
        <span><b>${m.label}</b><small>${esc(m.hint)}</small></span></label>`).join('');

    setView(head + `
      <form id="reqForm" class="section form" novalidate>
        <h2>1. 봉투 크기</h2><div class="choices">${sizeCards}</div>
        <div class="stepper"><span>봉투 개수</span>
          <button type="button" data-step="-1" aria-label="하나 빼기">−</button><output id="count">1</output>
          <button type="button" data-step="1" aria-label="하나 더하기">＋</button></div>

        <h2>2. 분류 방법</h2><div class="choices two">${modeCards}</div>

        <h2>3. 날짜와 시간</h2>
        ${dates.length ? `<div class="chips" id="dateChips">${dates.map((d, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-date="${d}">${dateLabel(d)}</button>`).join('')}</div>
        <div class="chips" id="slotChips"></div>
        <p class="tiny muted">고른 시간이 시작되기 전까지 문 앞에 내놓아 주세요.</p>`
        : '<div class="empty">2주 안에 신청할 수 있는 날이 없어요.</div>'}

        <h2>4. 문 앞 위치와 연락처</h2>
        <div class="grid2">
          <label>동<input name="dong" inputmode="numeric" maxlength="10" placeholder="예: 101" required /></label>
          <label>호<input name="ho" inputmode="numeric" maxlength="10" placeholder="예: 1203" required /></label>
        </div>
        <label>휴대폰 번호<input name="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" required /></label>
        <label>도우미에게 남길 말 (선택)<input name="memo" maxlength="200" placeholder="예: 박스는 접어서 묶어 두었어요" /></label>
        ${c.drop_note ? `<p class="hint">📌 ${esc(c.drop_note)}</p>` : ''}

        <div class="card summary" id="summary"></div>

        <label class="check"><input type="checkbox" name="agreeItems" required />
          <span>음식물·종량제 봉투·대형폐기물·가전·위험물·의류는 넣지 않았어요.</span></label>
        <label class="check"><input type="checkbox" name="agreePrivacy" required />
          <span>동·호수와 연락처를 이 신청 처리에만 쓰는 데 동의해요. 동·호수는 맡은 도우미에게만 보이고, 연락처는 관리자만 봐요.</span></label>

        <button class="btn primary big" type="submit" ${dates.length ? '' : 'disabled'}>신청하기</button>
      </form>`);

    const form = document.getElementById('reqForm');
    let count = 1; let date = dates[0]; let slot = '';
    const drawSlots = () => {
      const box = document.getElementById('slotChips'); if (!box) return;
      const slots = slotsFor(c, date);
      if (!slots.find((s) => s.value === slot)) slot = slots[0] ? slots[0].value : '';
      box.innerHTML = slots.map((s) => `<button type="button" class="chip ${s.value === slot ? 'on' : ''}" data-slot="${s.value}">${s.label}</button>`).join('');
    };
    const drawPrice = () => {
      const size = form.size.value; const mode = form.mode.value;
      Object.keys(P.bags).forEach((k) => { const el = form.querySelector(`[data-price="${k}"]`); if (el) el.textContent = won(pickupPrice(k, mode, 1).list); });
      const pr = pickupPrice(size, mode, count);
      document.getElementById('summary').innerHTML = `
        <div><span>${esc(P.bags[size].label)} ${count}개 · ${esc(P.modes[mode].label)}</span><span>${won(pr.list)}</span></div>
        ${P.freePilot ? `<div class="free"><span>무료 시범 할인</span><span>−${won(pr.list)}</span></div>` : ''}
        <div class="total"><span>이용료</span><b>${won(pr.charge)}</b></div>
        ${date && slot ? `<p class="tiny muted">${dateLabel(date)} ${slot} 시작 시간대</p>` : ''}`;
    };
    form.addEventListener('change', drawPrice);
    form.addEventListener('click', (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.step) { count = Math.max(1, Math.min(P.maxBags, count + Number(t.dataset.step))); document.getElementById('count').textContent = count; drawPrice(); }
      if (t.dataset.date) { date = t.dataset.date; form.querySelectorAll('[data-date]').forEach((b) => b.classList.toggle('on', b === t)); drawSlots(); drawPrice(); }
      if (t.dataset.slot) { slot = t.dataset.slot; form.querySelectorAll('[data-slot]').forEach((b) => b.classList.toggle('on', b === t)); drawPrice(); }
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const phone = form.phone.value.replace(/\D/g, '');
      if (!date || !slot) return notice('날짜와 시간을 골라 주세요.', true);
      if (!form.dong.value.trim() || !form.ho.value.trim()) return notice('동·호수를 적어 주세요.', true);
      if (!/^01\d{8,9}$/.test(phone)) return notice('휴대폰 번호를 확인해 주세요.', true);
      if (!form.agreeItems.checked || !form.agreePrivacy.checked) return notice('안내 사항 두 가지에 체크해 주세요.', true);
      const pr = pickupPrice(form.size.value, form.mode.value, count);
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '신청 중…';
      try {
        await API.createRequest({ complexId: c.id, size: form.size.value, mode: form.mode.value, count, date, slot,
          dong: form.dong.value.trim(), ho: form.ho.value.trim(), phone, memo: form.memo.value.trim(), listPrice: pr.list, helperFee: pr.helperFee });
        notice('신청했어요! 도우미가 맡으면 알려 드릴게요.');
        location.hash = '#/my';
      } catch (e) { notice(errText(e), true); btn.disabled = false; btn.textContent = '신청하기'; }
    });
    drawSlots(); drawPrice();
  }

  /* ---------- 내 신청 ---------- */
  async function renderMy() {
    loading();
    const me = await API.me().catch(() => null);
    if (!me) { setView(`<section class="page-head"><h1>내 신청</h1></section><section class="section">${loginCard('로그인이 필요해요', '신청 내역과 완료 사진을 볼 수 있어요.')}</section>`); return; }
    let rows = [];
    try { rows = await API.myRequests(); } catch (e) { setView(`<div class="empty">${esc(errText(e))}</div>`); return; }
    setView(`<section class="page-head"><h1>내 신청</h1><p class="muted">도우미가 맡거나 배출을 마치면 알려 드려요.</p>
        <div class="row-actions"><button class="btn ghost small" data-act="push">🔔 알림 켜기</button><button class="btn ghost small" data-act="logout">로그아웃</button></div></section>
      <section class="section list">
        ${rows.length ? rows.map((r) => `
          <article class="card item">
            <header><b>${esc(r.pickup_complexes ? r.pickup_complexes.name : '')}</b>${badge(STATUS_REQ, r.status)}</header>
            <p>${dateLabel(r.pickup_date)} ${hhmm(r.slot_start)} · ${esc(bagText(r))}</p>
            <p class="muted tiny">${esc(r.dong)}동 ${esc(r.ho)}호 · 이용료 ${won(r.charge)}</p>
            <div class="row-actions">
              ${r.status === 'requested' ? `<button class="btn ghost small" data-cancel="${esc(r.id)}">신청 취소</button>` : ''}
              ${r.status === 'done' && r.photo_path ? `<button class="btn ghost small" data-photo="${esc(r.photo_path)}">완료 사진 보기</button>` : ''}
            </div>
            <div class="photo-box"></div>
          </article>`).join('') : '<div class="empty">아직 신청이 없어요. <a href="#/">우리 단지 찾기</a></div>'}
      </section>`);
    view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('이 신청을 취소할까요?')) return;
      try { const ok = await API.cancelRequest(b.dataset.cancel); notice(ok ? '취소했어요.' : '이미 도우미가 맡아 취소할 수 없어요.', !ok); renderMy(); }
      catch (e) { notice(errText(e), true); }
    }));
    view.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => showPhoto(b)));
  }

  async function showPhoto(btn) {
    const box = btn.closest('.card').querySelector('.photo-box');
    try { const url = await API.photoUrl(btn.dataset.photo); box.innerHTML = url ? `<img src="${esc(url)}" alt="배출 완료 사진" />` : '<p class="muted tiny">사진이 없어요.</p>'; }
    catch (e) { notice(errText(e), true); }
  }

  /* ---------- 도우미 ---------- */
  async function renderHelper() {
    loading();
    const me = await API.me().catch(() => null);
    const intro = `<section class="page-head"><h1>도우미</h1><p class="muted">같은 단지 이웃의 재활용품을 분리수거장에 대신 내놓고 수고비를 받아요.</p></section>`;
    if (!me) {
      setView(intro + `<section class="section"><div class="card"><ul class="bullets">
          <li>그 단지에 실제로 사는 분만 할 수 있어요.</li>
          <li>휴대폰 본인 확인과 동·호수 확인을 거쳐요.</li>
          <li>새 일감이 생기면 알림이 오고, 먼저 수락한 분이 맡아요.</li>
          <li>배출 후 완료 사진을 올리면 끝이에요. 사진에 호수·얼굴·차 번호판이 보이지 않게 찍어 주세요.</li></ul></div>
        ${loginCard('로그인하고 도우미 신청하기', '카카오 계정으로 신청해요.')}</section>`);
      return;
    }
    let h;
    try { h = await API.helperMe(); } catch (e) { setView(intro + `<div class="empty">${esc(errText(e))}</div>`); return; }
    if (!h || h.status === 'rejected') return renderHelperApply(intro, h);
    if (h.status === 'pending') {
      setView(intro + `<section class="section"><div class="card">
        <h2>신청을 확인하고 있어요 ${badge(STATUS_HELPER, 'pending')}</h2>
        <p>${esc(h.pickup_complexes ? h.pickup_complexes.name : '')} · ${esc(h.dong)}동</p>
        <p class="muted">본인 확인과 동·호수 확인을 마치면 승인해 드려요. 확인을 위해 연락드릴 수 있어요.</p>
        <button class="btn ghost" data-act="reload">새로고침</button></div></section>`);
      return;
    }
    if (h.status !== 'approved') {
      setView(intro + `<section class="section"><div class="card"><p>지금은 도우미 활동이 멈춰 있어요. 카카오 채널로 문의해 주세요.</p></div></section>`);
      return;
    }
    const tabs = [['open', '새 일감'], ['mine', '맡은 일'], ['money', '정산']];
    setView(`<section class="page-head"><h1>도우미 ${badge(STATUS_HELPER, 'approved')}</h1>
        <p class="muted">${esc(h.pickup_complexes ? h.pickup_complexes.name : '')} · ${esc(h.name)}님</p>
        <div class="row-actions"><button class="btn ghost small" data-act="push">🔔 새 일감 알림 켜기</button></div></section>
      <nav class="tabs">${tabs.map(([k, t]) => `<button class="${helperTab === k ? 'on' : ''}" data-htab="${k}">${t}</button>`).join('')}</nav>
      <section class="section list" id="helperBody"><div class="loading">불러오는 중…</div></section>`);
    view.querySelectorAll('[data-htab]').forEach((b) => b.addEventListener('click', () => { helperTab = b.dataset.htab; renderHelper(); }));
    const body = document.getElementById('helperBody');
    try {
      if (helperTab === 'open') await helperOpen(body);
      else if (helperTab === 'mine') await helperMine(body);
      else await helperMoney(body);
    } catch (e) { body.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; }
  }

  async function renderHelperApply(intro, prev) {
    let complexes = [];
    try { complexes = (await API.listComplexes()).filter((c) => c.status === 'open' || c.status === 'pending'); } catch (_) {}
    setView(intro + `<form id="helperForm" class="section form" novalidate>
      ${prev && prev.status === 'rejected' ? '<p class="hint">지난 신청이 승인되지 않았어요. 정보를 확인하고 다시 신청해 주세요.</p>' : ''}
      <label>사는 단지<select name="complex" required>${complexes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${STATUS_COMPLEX[c.status][0]})</option>`).join('')}</select></label>
      <label>이름<input name="name" maxlength="20" required /></label>
      <label>휴대폰 번호<input name="phone" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" required /></label>
      <div class="grid2"><label>동<input name="dong" inputmode="numeric" maxlength="10" required /></label>
        <label>호<input name="ho" inputmode="numeric" maxlength="10" required /></label></div>
      <label class="check"><input type="checkbox" name="live" /><span>이 단지에 실제로 살고 있어요.</span></label>
      <label class="check"><input type="checkbox" name="agree" /><span>본인 확인과 동·호수 확인을 위해 이름·연락처·동호수를 관리자가 확인하는 데 동의해요.</span></label>
      <button class="btn primary big" type="submit" ${complexes.length ? '' : 'disabled'}>도우미 신청하기</button>
      ${complexes.length ? '' : '<p class="muted tiny">지금 도우미를 모집하는 단지가 없어요.</p>'}
    </form>`);
    const f = document.getElementById('helperForm');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const phone = f.phone.value.replace(/\D/g, '');
      if (f.name.value.trim().length < 2 || !/^01\d{8,9}$/.test(phone) || !f.dong.value.trim() || !f.ho.value.trim()) return notice('이름·휴대폰·동·호수를 확인해 주세요.', true);
      if (!f.live.checked || !f.agree.checked) return notice('두 가지 확인란에 체크해 주세요.', true);
      try {
        await API.helperApply({ complexId: f.complex.value, name: f.name.value.trim(), phone, dong: f.dong.value.trim(), ho: f.ho.value.trim() });
        notice('도우미 신청을 받았어요. 확인 후 승인해 드릴게요.'); renderHelper();
      } catch (e) { notice(errText(e), true); }
    });
  }

  async function helperOpen(body) {
    const jobs = await API.openJobs();
    body.innerHTML = jobs.length ? jobs.map((j) => `
      <article class="card item">
        <header><b>${dateLabel(j.pickup_date)} ${hhmm(j.slot_start)}</b><span class="fee">${won(j.helper_fee)}</span></header>
        <p>${esc(j.dong)}동 · ${esc(bagText(j))}</p>
        <p class="muted tiny">호수는 맡은 뒤에 보여요.</p>
        <button class="btn primary" data-accept="${esc(j.id)}">이 일 맡기</button>
      </article>`).join('') : '<div class="empty">지금은 새 일감이 없어요. 알림을 켜 두면 생길 때 알려 드려요.</div>';
    body.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const ok = await API.acceptJob(b.dataset.accept);
        notice(ok ? '맡았어요! "맡은 일"에서 위치를 확인하세요.' : '다른 도우미가 먼저 맡았어요.', !ok);
        if (ok) helperTab = 'mine';
        renderHelper();
      } catch (e) { b.disabled = false; notice(errText(e), true); }
    }));
  }

  async function helperMine(body) {
    const jobs = await API.myJobs();
    const active = jobs.filter((j) => j.status === 'accepted'); const done = jobs.filter((j) => j.status === 'done');
    body.innerHTML = (active.length ? active.map((j) => `
      <article class="card item" data-job="${esc(j.id)}">
        <header><b>${dateLabel(j.pickup_date)} ${hhmm(j.slot_start)}</b>${badge(STATUS_REQ, 'accepted')}</header>
        <p class="big-loc">${esc(j.dong)}동 ${esc(j.ho)}호 문 앞</p>
        <p>${esc(bagText(j))} · 수고비 ${won(j.helper_fee)}</p>
        ${j.memo ? `<p class="hint">💬 ${esc(j.memo)}</p>` : ''}
        <div class="photo-guide">📷 분리수거장에 배출한 뒤 찍어 주세요. <b>호수·얼굴·차 번호판이 보이지 않게</b> 찍어 주세요.</div>
        <label class="btn ghost file-btn">완료 사진 고르기<input type="file" accept="image/*" capture="environment" hidden /></label>
        <img class="preview hidden" alt="올릴 사진 미리보기" />
        <div class="row-actions">
          <button class="btn primary" data-done disabled>배출 완료</button>
          <button class="btn ghost small" data-release>못 하게 됐어요</button>
        </div>
      </article>`).join('') : '<div class="empty">맡은 일이 없어요. "새 일감"에서 맡아 보세요.</div>')
      + (done.length ? `<h3 class="sub">완료한 일</h3>` + done.map((j) => `
      <article class="card item slim"><header><span>${dateLabel(j.pickup_date)} ${hhmm(j.slot_start)} · ${esc(j.dong)}동</span><span class="fee">${won(j.helper_fee)}</span></header></article>`).join('') : '');

    body.querySelectorAll('[data-job]').forEach((card) => {
      const id = card.dataset.job; let blob = null;
      const input = card.querySelector('input[type=file]'); const img = card.querySelector('.preview'); const doneBtn = card.querySelector('[data-done]');
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0]; if (!file) return;
        try { blob = await shrinkPhoto(file); img.src = URL.createObjectURL(blob); img.classList.remove('hidden'); doneBtn.disabled = false; }
        catch (_) { notice('사진을 읽지 못했어요. 다른 사진으로 해 주세요.', true); }
      });
      doneBtn.addEventListener('click', async () => {
        if (!blob) return;
        doneBtn.disabled = true; doneBtn.textContent = '올리는 중…';
        try {
          const path = await API.uploadPhoto(blob);
          const ok = await API.completeJob(id, path);
          notice(ok ? '수고하셨어요! 손님에게 완료 알림을 보냈어요.' : '완료 처리하지 못했어요. 새로고침 후 다시 해 주세요.', !ok);
          renderHelper();
        } catch (e) { doneBtn.disabled = false; doneBtn.textContent = '배출 완료'; notice(errText(e), true); }
      });
      card.querySelector('[data-release]').addEventListener('click', async () => {
        if (!confirm('이 일을 다른 도우미에게 돌려놓을까요?')) return;
        try { await API.releaseJob(id); notice('돌려놓았어요.'); renderHelper(); } catch (e) { notice(errText(e), true); }
      });
    });
  }

  async function helperMoney(body) {
    const m = await API.myEarnings();
    const left = (m.earned || 0) - (m.paid || 0);
    body.innerHTML = `
      <div class="stats">
        <div><small>완료</small><b>${m.doneCount || 0}건</b></div>
        <div><small>번 금액</small><b>${won(m.earned)}</b></div>
        <div><small>받을 금액</small><b class="accent">${won(left)}</b></div>
      </div>
      <p class="muted tiny">수고비는 계좌이체로 정해진 날에 모아서 보내 드려요(정산 주기 미정). 받은 내역은 아래에 쌓여요.</p>
      <h3 class="sub">받은 내역</h3>
      ${(m.payouts || []).length ? m.payouts.map((p) => `<div class="card item slim"><header><span>${esc(p.period || '')} ${esc(String(p.paidAt || '').slice(0, 10))}</span><b>${won(p.amount)}</b></header></div>`).join('') : '<div class="empty">아직 받은 내역이 없어요.</div>'}`;
  }

  // 사진을 1280px 이하 JPG로 줄입니다. (휴대폰 위치 정보 같은 사진 속 정보도 함께 빠집니다)
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1280; const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), 'image/jpeg', 0.8);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('읽기 실패')); };
      img.src = url;
    });
  }

  /* ---------- 관리자 ---------- */
  async function renderAdmin() {
    loading();
    const me = await API.me().catch(() => null);
    if (!me) { setView(`<section class="page-head"><h1>관리</h1></section><section class="section">${loginCard('관리자 로그인', '사장님 계정으로 로그인해 주세요.')}</section>`); return; }
    if (!(await API.isOwner())) { setView('<section class="page-head"><h1>관리</h1></section><div class="empty">관리자만 볼 수 있어요.</div>'); return; }
    const tabs = [['requests', '신청'], ['helpers', '도우미'], ['complexes', '단지'], ['money', '정산']];
    setView(`<section class="page-head"><h1>관리</h1>
        ${API.demo ? '<div class="row-actions"><button class="btn ghost small" data-act="demoReset">미리보기 자료 처음으로</button></div>' : ''}</section>
      <nav class="tabs">${tabs.map(([k, t]) => `<button class="${adminTab === k ? 'on' : ''}" data-atab="${k}">${t}</button>`).join('')}</nav>
      <section class="section list" id="adminBody"><div class="loading">불러오는 중…</div></section>`);
    view.querySelectorAll('[data-atab]').forEach((b) => b.addEventListener('click', () => { adminTab = b.dataset.atab; renderAdmin(); }));
    const body = document.getElementById('adminBody');
    try {
      if (adminTab === 'requests') await adminRequests(body);
      else if (adminTab === 'helpers') await adminHelpers(body);
      else if (adminTab === 'complexes') await adminComplexes(body);
      else await adminMoney(body);
    } catch (e) { body.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; }
  }

  async function adminRequests(body) {
    const rows = await API.adminRequests();
    const count = (s) => rows.filter((r) => r.status === s).length;
    body.innerHTML = `<div class="stats four">
        <div><small>접수</small><b>${count('requested')}</b></div><div><small>배정</small><b>${count('accepted')}</b></div>
        <div><small>완료</small><b>${count('done')}</b></div><div><small>취소</small><b>${count('cancelled')}</b></div></div>`
      + (rows.length ? rows.map((r) => `
      <article class="card item">
        <header><b>${dateLabel(r.pickup_date)} ${hhmm(r.slot_start)}</b>${badge(STATUS_REQ, r.status)}</header>
        <p>${esc(r.pickup_complexes ? r.pickup_complexes.name : '')} · ${esc(r.dong)}동 ${esc(r.ho)}호</p>
        <p class="muted tiny">${esc(bagText(r))} · 정상가 ${won(r.list_price)} · 받은 이용료 ${won(r.charge)} · 수고비 ${won(r.helper_fee)}</p>
        <p class="muted tiny"><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>${r.pickup_helpers ? ' · 도우미 ' + esc(r.pickup_helpers.name) : ''}${r.memo ? ' · ' + esc(r.memo) : ''}</p>
        ${r.photo_path ? `<button class="btn ghost small" data-photo="${esc(r.photo_path)}">완료 사진</button><div class="photo-box"></div>` : ''}
      </article>`).join('') : '<div class="empty">신청이 없어요.</div>');
    body.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => showPhoto(b)));
  }

  async function adminHelpers(body) {
    const rows = await API.adminHelpers();
    body.innerHTML = rows.length ? rows.map((h) => `
      <article class="card item">
        <header><b>${esc(h.name)}</b>${badge(STATUS_HELPER, h.status)}</header>
        <p>${esc(h.pickup_complexes ? h.pickup_complexes.name : '')} · ${esc(h.dong)}동 ${esc(h.ho)}호</p>
        <p class="muted tiny"><a href="tel:${esc(h.phone)}">${esc(h.phone)}</a> · 신청 ${esc(String(h.created_at || '').slice(0, 10))}</p>
        <div class="row-actions">
          ${h.status !== 'approved' ? `<button class="btn primary small" data-hs="approved" data-id="${esc(h.user_id)}">본인·동호수 확인 완료 → 승인</button>` : ''}
          ${h.status === 'approved' ? `<button class="btn ghost small" data-hs="suspended" data-id="${esc(h.user_id)}">활동 중지</button>` : ''}
          ${h.status === 'pending' ? `<button class="btn ghost small" data-hs="rejected" data-id="${esc(h.user_id)}">반려</button>` : ''}
        </div>
      </article>`).join('') : '<div class="empty">도우미 신청이 없어요.</div>';
    body.querySelectorAll('[data-hs]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.hs === 'approved' && !confirm('휴대폰 본인 확인과 그 단지 거주(동·호수) 확인을 마쳤나요?')) return;
      try { await API.setHelperStatus(b.dataset.id, b.dataset.hs); notice('바꿨어요.'); renderAdmin(); } catch (e) { notice(errText(e), true); }
    }));
  }

  async function adminComplexes(body) {
    const rows = await API.adminComplexes();
    body.innerHTML = rows.map((c) => `
      <article class="card item"><header><b>${esc(c.name)}</b>${badge(STATUS_COMPLEX, c.status)}</header>
        <p class="muted tiny">${esc(c.region)} · ${daysText(c.weekdays)} ${hhmm(c.start_time)}~${hhmm(c.end_time)} · ${c.slot_minutes}분 단위 · 하루 ${c.daily_limit || 30}건</p>
        <button class="btn ghost small" data-edit="${esc(c.id)}">고치기</button></article>`).join('')
      + '<button class="btn primary" data-edit="">＋ 단지 추가</button><div id="complexEditor"></div>';
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => complexEditor(rows.find((c) => c.id === b.dataset.edit) || null)));
  }

  function complexEditor(c) {
    c = c || { name: '', region: '', status: 'preparing', weekdays: [], start_time: '19:00', end_time: '22:00', slot_minutes: 60, daily_limit: 30, drop_note: '' };
    const box = document.getElementById('complexEditor');
    box.innerHTML = `<form class="card form" id="cxForm">
      <h3>${c.id ? '단지 고치기' : '새 단지'}</h3>
      <label>단지 이름<input name="name" value="${esc(c.name)}" required /></label>
      <label>지역<input name="region" value="${esc(c.region)}" placeholder="예: 대구 수성구" /></label>
      <label>상태<select name="status">${Object.entries(STATUS_COMPLEX).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <p class="tiny muted">"이용 가능"은 관리사무소 승인을 받은 뒤에만 고르세요. 그 전에는 손님 신청 화면이 열리지 않아요.</p>
      <fieldset class="days"><legend>배출 요일</legend>${WEEK.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${(c.weekdays || []).includes(i) ? 'checked' : ''}/>${d}</label>`).join('')}</fieldset>
      <div class="grid2"><label>시작<input type="time" name="start_time" value="${hhmm(c.start_time)}" /></label>
        <label>끝<input type="time" name="end_time" value="${hhmm(c.end_time)}" /></label></div>
      <div class="grid2"><label>시간 단위(분)<input type="number" name="slot_minutes" min="15" max="240" value="${c.slot_minutes}" /></label>
        <label>하루 최대 건수<input type="number" name="daily_limit" min="1" max="500" value="${c.daily_limit || 30}" /></label></div>
      <label>손님 안내 문구<input name="drop_note" value="${esc(c.drop_note)}" maxlength="120" /></label>
      <button class="btn primary" type="submit">저장</button></form>`;
    box.scrollIntoView({ behavior: 'smooth' });
    const f = document.getElementById('cxForm');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!f.name.value.trim()) return notice('단지 이름을 적어 주세요.', true);
      if (f.status.value === 'open' && c.status !== 'open' && !confirm('관리사무소 승인을 받았나요? 이용 가능으로 바꾸면 손님 신청이 열려요.')) return;
      const data = { name: f.name.value.trim(), region: f.region.value.trim(), status: f.status.value,
        weekdays: [...f.querySelectorAll('[name=wd]:checked')].map((x) => Number(x.value)),
        start_time: f.start_time.value, end_time: f.end_time.value, slot_minutes: Number(f.slot_minutes.value) || 60,
        daily_limit: Number(f.daily_limit.value) || 30, drop_note: f.drop_note.value.trim() };
      if (f.status.value === 'open' && c.status !== 'open') data.approved_at = new Date().toISOString();
      if (c.id) data.id = c.id;
      try { await API.saveComplex(data); notice('저장했어요.'); renderAdmin(); } catch (e) { notice(errText(e), true); }
    });
  }

  async function adminMoney(body) {
    const rows = await API.adminSettlement();
    body.innerHTML = `<p class="muted tiny">도우미에게 계좌이체로 보낸 뒤 "지급 기록"을 남기면 도우미 정산 화면에 반영돼요.</p>` + (rows.length ? rows.map((r) => {
      const left = Number(r.earned) - Number(r.paid);
      return `<article class="card item">
        <header><b>${esc(r.name)}</b><span>완료 ${r.done_count}건</span></header>
        <p class="muted tiny">번 금액 ${won(r.earned)} · 보낸 금액 ${won(r.paid)} · <b>남은 금액 ${won(left)}</b></p>
        ${left > 0 ? `<form class="pay-form" data-helper="${esc(r.helper_id)}"><input name="amount" type="number" min="1" value="${left}" /><input name="period" placeholder="예: 12월 1주" /><button class="btn primary small">지급 기록</button></form>` : ''}
      </article>`;
    }).join('') : '<div class="empty">도우미가 없어요.</div>');
    body.querySelectorAll('.pay-form').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const amount = Number(f.amount.value);
      if (!(amount > 0)) return notice('금액을 확인해 주세요.', true);
      if (!confirm(won(amount) + ' 보낸 것으로 기록할까요?')) return;
      try { await API.addPayout({ helperId: f.dataset.helper, amount, period: f.period.value.trim() }); notice('기록했어요.'); renderAdmin(); }
      catch (e) { notice(errText(e), true); }
    }));
  }

  /* ---------- 화면 이동 ---------- */
  async function route() {
    const hash = (location.hash || '').replace(/^#\/?/, '');
    if (/(^|&)(access_token|error)=/.test(hash)) return;
    const [page, arg] = hash.split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on',
      a.dataset.nav === (page === 'c' || !page ? 'home' : page)));
    if (page === 'c' && arg) return renderComplex(decodeURIComponent(arg));
    if (page === 'my') return renderMy();
    if (page === 'helper') return renderHelper();
    if (page === 'admin') return renderAdmin();
    return renderHome();
  }

  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'login') API.login(location.hash);
    if (act === 'logout') { await API.logout(); notice('로그아웃했어요.'); route(); refreshAdminNav(); }
    if (act === 'reload') route();
    if (act === 'push') { try { await API.enablePush(); notice('알림을 켰어요.'); } catch (e) { notice(errText(e), true); } }
    if (act === 'demoReset') { API.reset(); notice('미리보기 자료를 처음으로 돌렸어요.'); route(); }
  });

  async function refreshAdminNav() {
    const ok = await API.isOwner().catch(() => false);
    document.getElementById('navAdmin').classList.toggle('hidden', !ok);
    document.querySelector('.bottom-nav').classList.toggle('four', ok);
  }

  window.addEventListener('hashchange', () => { route(); refreshAdminNav(); });
  if (API.demo) document.getElementById('demoBadge').classList.remove('hidden');
  if (API.oauthError()) notice('카카오 로그인을 마치지 못했어요. (' + API.oauthError().slice(0, 80) + ')', true);
  route(); refreshAdminNav();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
  }
})();
