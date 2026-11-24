# 실제 운영 전에 할 일 (사장님 체크리스트)

미리보기는 지금 바로 볼 수 있습니다. 실제 손님·도우미가 쓰려면 아래를 순서대로 합니다.
비밀키는 채팅이나 코드에 넣지 말고, 각 서비스 설정 화면에 직접 입력해 주세요.

## 1. DB 적용 (Supabase)
1. Supabase → SQL Editor 에 `database/01_20261124_pickup_core.sql` 전체를 붙여넣고 실행
2. 관리 화면(`#/admin`)에서 시험 단지를 추가 (처음에는 "승인 대기"로)
3. `supabase-integration.js` 의 `DB_READY` 를 `true` 로 바꾸고 올리기

## 2. 카카오 로그인 주소 등록
- Supabase → Authentication → URL Configuration → **Redirect URLs** 에 새 앱 주소를 추가
  (예: `https://tran0004-sudo.github.io/athome-pickup/`). 안 하면 로그인 후 카케어 주소로 돌아갑니다.

## 3. 알림 (새 일감 / 배출 완료)
1. `supabase functions deploy pickup-notify --no-verify-jwt`
   (VAPID 키·NOTIFY_WEBHOOK_SECRET 은 카케어 notify-push 와 같은 Secrets 를 함께 씁니다)
2. Supabase → Database → Webhooks → 새 Webhook
   - 표: `pickup_requests`, 이벤트: Insert, Update
   - 주소: pickup-notify 함수 주소, HTTP Header `x-webhook-secret` = NOTIFY_WEBHOOK_SECRET 값

## 4. 도우미 확인 (지금은 사람이 직접)
- 휴대폰 본인인증: 1차는 통화·문자로 사장님이 직접 확인합니다. 자동 본인인증(PASS 등)은 결제대행사 연동 때 붙입니다.
- 동·호수 확인: 관리사무소 확인 또는 우편물·관리비 고지서 등으로 확인 (방법은 관리사무소와 협의)
- 확인을 마친 뒤 관리 화면 → 도우미 → "승인"

## 5. 단지 열기 전에 (바꾸려면 먼저 확인)
- 관리사무소 승인이 난 단지만 "이용 가능"으로 바꿉니다. 그 전에는 신청 화면이 열리지 않습니다.
- 유료 전환(`prices.js` 의 `freePilot: false`)은 **환경 부서 서면 확인 · 관리사무소 승인 · 배상책임보험**이 모두 끝난 뒤에 합니다.
  법·세금·보험 내용은 담당 부서(구청 환경과, 세무사)에 서면으로 확인해 주세요.

## 아직 정하지 않은 것
- 시험 단지, 요금 확정, 도우미 수고비(지금 값은 가정), 정산 주기, 결제 방식, 앱 이름과 도메인
