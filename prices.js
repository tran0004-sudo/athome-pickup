/* 앳홈 집앞 분리배출 | 요금 — 요금은 이 파일에서만 고칩니다.
   ※ 아래 숫자는 모두 "예시(가정)"입니다. 시범 운영 후 확정합니다.
   ※ 손님 화면에는 "수거비·처리비"가 아니라 "이용료"라고만 씁니다. */
window.PICKUP_PRICES = {
  // 무료 시범 기간: true 인 동안은 손님에게 0원으로 받습니다.
  // 환경 부서 서면 확인 · 관리사무소 승인 · 배상책임보험이 모두 끝난 뒤에만 false 로 바꿉니다.
  freePilot: true,

  // 봉투 크기별 정액 이용료 (분류 완료 기준, 원) — 예시
  bags: {
    S: { label: '소', hint: '마트 비닐봉투 1개 정도 (약 20L)', sorted: 3000, unsorted: 4000 },
    M: { label: '중', hint: '장바구니 1개 정도 (약 50L)', sorted: 4500, unsorted: 6000 },
    L: { label: '대', hint: '큰 비닐봉투·박스 묶음 (약 100L)', sorted: 6000, unsorted: 8000 }
  },

  // 분류 모드
  modes: {
    sorted:   { label: '분류 완료', hint: '종이·플라스틱·캔·유리·비닐을 나눠서 내놓아요' },
    unsorted: { label: '분류 포함', hint: '한 봉투에 섞어 두면 도우미가 나눠서 배출해요' }
  },

  // 한 번에 내놓을 수 있는 봉투 수
  maxBags: 3,

  // 도우미 수고비 비율 (이용료의 몇 %를 도우미에게) — 가정. 플랫폼 수수료 20~30% 시험
  helperShare: 0.75,

  // 무료 시범 기간에 도우미에게 드리는 건당 수고비 (원) — 가정, 미정
  pilotHelperFee: { S: 2000, M: 3000, L: 4000 },

  // 월 4회 구독 할인율 — 예시 (구독은 2차에 엽니다)
  subscriptionDiscount: 0.10
};

window.pickupPrice = function (size, mode, count) {
  const P = window.PICKUP_PRICES;
  const bag = P.bags[size];
  if (!bag) return { list: 0, charge: 0, helperFee: 0 };
  const n = Math.max(1, Math.min(P.maxBags, Number(count) || 1));
  const list = (mode === 'unsorted' ? bag.unsorted : bag.sorted) * n;
  const charge = P.freePilot ? 0 : list;
  const helperFee = P.freePilot ? (P.pilotHelperFee[size] || 0) * n
    : Math.round(list * P.helperShare / 100) * 100;
  return { list, charge, helperFee };
};

window.won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
