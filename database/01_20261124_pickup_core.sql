-- ============================================================
-- 앳홈 집앞 분리배출 | 기본 표·권한·함수 (2026-11-24)
-- Supabase → SQL Editor 에 "전체 선택 후 한 번에" 실행하세요.
-- 중간에 오류가 나면 전체가 취소되어 안전합니다.
--
-- 앳홈 카케어와 같은 Supabase 프로젝트를 쓰므로 표 이름은 모두 pickup_ 으로 시작합니다.
-- 관리자 판별은 카케어에서 이미 만든 public.is_owner() 를 그대로 씁니다(14번 SQL).
-- 개인정보(동·호수, 연락처, 사진)는 관리자만 전부 보고,
-- 도우미는 자기에게 배정된 건만 함수로 봅니다.
-- ============================================================

begin;

-- 0) 카케어 SQL 14번이 적용되어 is_owner() 가 있어야 합니다.
do $$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'public.is_owner() 가 없습니다. 카케어 database/14번 SQL을 먼저 적용하세요.';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1) 단지 목록 + 단지 규칙 (배출 요일·시간·승인 상태)
-- ------------------------------------------------------------
create table if not exists public.pickup_complexes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                         -- 단지 이름
  region        text not null default '',              -- 예: 대구 수성구, 경산
  status        text not null default 'preparing'
                check (status in ('open','pending','preparing','closed')),
                -- open 이용 가능 / pending 관리사무소 승인 대기 / preparing 준비 중 / closed 숨김
  weekdays      smallint[] not null default '{}',      -- 배출 가능 요일 (0=일 ~ 6=토)
  start_time    time not null default '19:00',         -- 배출 시작 시각
  end_time      time not null default '22:00',         -- 배출 끝 시각
  slot_minutes  smallint not null default 60 check (slot_minutes between 15 and 240),
  daily_limit   smallint not null default 30 check (daily_limit between 1 and 500),
  drop_note     text not null default '',              -- 손님 안내 (예: 문 앞 오른쪽에 두세요)
  approved_at   timestamptz,                           -- 관리사무소 승인일
  created_at    timestamptz not null default now()
);
comment on table public.pickup_complexes is '서비스 단지와 배출 규칙. 승인(open)된 단지만 신청을 받습니다.';

-- ------------------------------------------------------------
-- 2) 도우미 (같은 단지 거주자만)
-- ------------------------------------------------------------
create table if not exists public.pickup_helpers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  complex_id   uuid not null references public.pickup_complexes(id),
  name         text not null,
  phone        text not null,
  dong         text not null,
  ho           text not null,
  status       text not null default 'pending'
               check (status in ('pending','approved','suspended','rejected')),
  verified_at  timestamptz,           -- 본인인증·동호수 확인을 마친 날 (관리자가 기록)
  admin_memo   text,
  created_at   timestamptz not null default now()
);
comment on table public.pickup_helpers is '도우미 신청·승인. 휴대폰 본인인증과 동호수 확인 후 관리자가 approved 로 바꿉니다.';

-- ------------------------------------------------------------
-- 3) 분리배출 신청 + 배정·완료 기록
-- ------------------------------------------------------------
create table if not exists public.pickup_requests (
  id           uuid primary key default gen_random_uuid(),
  complex_id   uuid not null references public.pickup_complexes(id),
  user_id      uuid not null references auth.users(id) on delete cascade,
  bag_size     text not null check (bag_size in ('S','M','L')),
  sort_mode    text not null check (sort_mode in ('sorted','unsorted')),
  bag_count    smallint not null default 1 check (bag_count between 1 and 3),
  pickup_date  date not null,
  slot_start   time not null,
  dong         text not null,
  ho           text not null,
  phone        text not null,
  memo         text not null default '',
  list_price   integer not null default 0 check (list_price >= 0),   -- 정상 이용료 (참고)
  charge       integer not null default 0 check (charge >= 0),       -- 실제 받는 이용료 (시범 0원)
  helper_fee   integer not null default 0 check (helper_fee >= 0),   -- 도우미 수고비
  status       text not null default 'requested'
               check (status in ('requested','accepted','done','cancelled')),
  helper_id    uuid references public.pickup_helpers(user_id),
  accepted_at  timestamptz,
  done_at      timestamptz,
  photo_path   text,                       -- 완료 사진 (pickup-photos 저장소 안 경로)
  pay_status   text not null default 'none' check (pay_status in ('none','waiting','paid')),
  created_at   timestamptz not null default now()
);
create index if not exists pickup_requests_complex_idx on public.pickup_requests (complex_id, status, pickup_date);
create index if not exists pickup_requests_user_idx on public.pickup_requests (user_id, created_at desc);
create index if not exists pickup_requests_helper_idx on public.pickup_requests (helper_id, status);
comment on table public.pickup_requests is '손님 신청. 손님은 자기 것만, 도우미는 함수로 배정된 건만, 관리자는 전부 봅니다.';

-- ------------------------------------------------------------
-- 4) 도우미 정산 (지급 기록)
-- ------------------------------------------------------------
create table if not exists public.pickup_payouts (
  id          uuid primary key default gen_random_uuid(),
  helper_id   uuid not null references public.pickup_helpers(user_id),
  amount      integer not null check (amount > 0),
  period      text not null default '',     -- 예: 2026-12 1주차
  paid_at     timestamptz not null default now(),
  memo        text
);
comment on table public.pickup_payouts is '도우미에게 수고비를 보낸 기록 (계좌이체 후 관리자가 기록).';

-- ------------------------------------------------------------
-- 5) 웹 푸시 구독 (도우미 새 일감 / 손님 완료 알림)
-- ------------------------------------------------------------
create table if not exists public.pickup_push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists pickup_push_user_idx on public.pickup_push_subscriptions (user_id);

-- ------------------------------------------------------------
-- 6) RLS 켜기 + GRANT
--    anon 은 select 만 줍니다. 실제로 읽을 수 있는 건 아래 정책이 허용한 단지 목록뿐입니다.
-- ------------------------------------------------------------
alter table public.pickup_complexes          enable row level security;
alter table public.pickup_helpers            enable row level security;
alter table public.pickup_requests           enable row level security;
alter table public.pickup_payouts            enable row level security;
alter table public.pickup_push_subscriptions enable row level security;

grant select on public.pickup_complexes, public.pickup_helpers, public.pickup_requests,
                public.pickup_payouts, public.pickup_push_subscriptions to anon;
grant select, insert, update, delete on public.pickup_complexes, public.pickup_helpers, public.pickup_requests,
                public.pickup_payouts, public.pickup_push_subscriptions to authenticated;
grant all on public.pickup_complexes, public.pickup_helpers, public.pickup_requests,
             public.pickup_payouts, public.pickup_push_subscriptions to service_role;

-- 단지 목록: 숨김(closed)이 아닌 단지는 누구나 조회 (손님 단지 검색용)
drop policy if exists pickup_complexes_public_read on public.pickup_complexes;
create policy pickup_complexes_public_read on public.pickup_complexes
  for select to anon, authenticated using (status <> 'closed');

-- 관리자: 모든 pickup_ 표 전체 권한
drop policy if exists pickup_complexes_owner_all on public.pickup_complexes;
create policy pickup_complexes_owner_all on public.pickup_complexes
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists pickup_helpers_owner_all on public.pickup_helpers;
create policy pickup_helpers_owner_all on public.pickup_helpers
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists pickup_requests_owner_all on public.pickup_requests;
create policy pickup_requests_owner_all on public.pickup_requests
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists pickup_payouts_owner_all on public.pickup_payouts;
create policy pickup_payouts_owner_all on public.pickup_payouts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- 도우미: 자기 신청서만 조회 (쓰기는 함수로만)
drop policy if exists pickup_helpers_self_read on public.pickup_helpers;
create policy pickup_helpers_self_read on public.pickup_helpers
  for select to authenticated using (user_id = auth.uid());

-- 손님: 자기 신청만 조회 (쓰기는 함수로만)
drop policy if exists pickup_requests_self_read on public.pickup_requests;
create policy pickup_requests_self_read on public.pickup_requests
  for select to authenticated using (user_id = auth.uid());

-- 도우미: 자기 지급 기록만 조회
drop policy if exists pickup_payouts_self_read on public.pickup_payouts;
create policy pickup_payouts_self_read on public.pickup_payouts
  for select to authenticated using (helper_id = auth.uid());

-- 푸시 구독: 자기 기기만 등록·조회·삭제
drop policy if exists pickup_push_self_all on public.pickup_push_subscriptions;
create policy pickup_push_self_all on public.pickup_push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 7) 함수 (화면에서 부르는 기능)
-- ------------------------------------------------------------

-- 승인된 도우미면 그 단지 id, 아니면 null
create or replace function public.pickup_my_helper_complex()
returns uuid language sql stable security definer set search_path = public as $$
  select complex_id from public.pickup_helpers
   where user_id = auth.uid() and status = 'approved';
$$;

-- [손님] 신청하기 — 승인된(open) 단지, 배출 요일·시간 안에서만 받습니다.
create or replace function public.pickup_create_request(
  p_complex uuid, p_size text, p_mode text, p_count int,
  p_date date, p_slot time, p_dong text, p_ho text, p_phone text, p_memo text,
  p_list_price int, p_helper_fee int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.pickup_complexes;
  today date := (now() at time zone 'Asia/Seoul')::date;
  now_time time := (now() at time zone 'Asia/Seoul')::time;
  new_id uuid;
  phone text := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = '28000'; end if;

  select * into c from public.pickup_complexes where id = p_complex;
  if not found or c.status <> 'open' then
    raise exception '아직 신청을 받지 않는 단지입니다.' using errcode = 'P0001';
  end if;
  if p_size not in ('S','M','L') or p_mode not in ('sorted','unsorted') or p_count not between 1 and 3 then
    raise exception '봉투 정보를 확인해 주세요.' using errcode = 'P0001';
  end if;
  if p_date < today or p_date > today + 14 then
    raise exception '오늘부터 2주 안의 날짜만 고를 수 있어요.' using errcode = 'P0001';
  end if;
  if not (extract(dow from p_date)::smallint = any(c.weekdays)) then
    raise exception '이 단지의 배출 요일이 아닙니다.' using errcode = 'P0001';
  end if;
  if p_slot < c.start_time or p_slot >= c.end_time
     or (extract(epoch from (p_slot - c.start_time))::int % (c.slot_minutes * 60)) <> 0 then
    raise exception '배출 시간 안에서 골라 주세요.' using errcode = 'P0001';
  end if;
  if p_date = today and p_slot <= now_time then
    raise exception '이미 지난 시간입니다.' using errcode = 'P0001';
  end if;
  if phone !~ '^01[0-9]{8,9}$' then
    raise exception '휴대폰 번호를 확인해 주세요.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_dong,''))) not between 1 and 10 or length(trim(coalesce(p_ho,''))) not between 1 and 10 then
    raise exception '동·호수를 확인해 주세요.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pickup_requests
       where user_id = auth.uid() and status in ('requested','accepted')) >= 3 then
    raise exception '진행 중인 신청이 3건 있어요. 완료된 뒤 다시 신청해 주세요.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pickup_requests
       where complex_id = c.id and pickup_date = p_date and status <> 'cancelled') >= c.daily_limit then
    raise exception '이 날은 신청이 꽉 찼어요. 다른 날을 골라 주세요.' using errcode = 'P0001';
  end if;

  insert into public.pickup_requests
    (complex_id, user_id, bag_size, sort_mode, bag_count, pickup_date, slot_start,
     dong, ho, phone, memo, list_price, charge, helper_fee)
  values
    (c.id, auth.uid(), p_size, p_mode, p_count, p_date, p_slot,
     trim(p_dong), trim(p_ho), phone, left(coalesce(p_memo,''), 200),
     -- 시범 기간에는 손님에게 받지 않습니다(charge 0). 금액은 화면 값을 상한만 걸어 참고로 저장합니다.
     -- 유료 전환 전에는 서버에서 요금을 다시 계산하도록 바꿔야 합니다.
     least(greatest(coalesce(p_list_price,0),0), 30000), 0,
     least(greatest(coalesce(p_helper_fee,0),0), 20000))
  returning id into new_id;
  return new_id;
end $$;

-- [손님] 취소 — 아직 도우미가 맡기 전만
create or replace function public.pickup_cancel_request(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.pickup_requests set status = 'cancelled'
   where id = p_id and user_id = auth.uid() and status = 'requested';
  return found;
end $$;

-- [도우미] 신청
create or replace function public.pickup_helper_apply(
  p_complex uuid, p_name text, p_phone text, p_dong text, p_ho text
) returns text
language plpgsql security definer set search_path = public as $$
declare phone text := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = '28000'; end if;
  if not exists (select 1 from public.pickup_complexes where id = p_complex and status in ('open','pending')) then
    raise exception '도우미를 모집하지 않는 단지입니다.' using errcode = 'P0001';
  end if;
  if phone !~ '^01[0-9]{8,9}$' or length(trim(coalesce(p_name,''))) < 2
     or length(trim(coalesce(p_dong,''))) = 0 or length(trim(coalesce(p_ho,''))) = 0 then
    raise exception '이름·휴대폰·동·호수를 확인해 주세요.' using errcode = 'P0001';
  end if;
  insert into public.pickup_helpers (user_id, complex_id, name, phone, dong, ho)
  values (auth.uid(), p_complex, trim(p_name), phone, trim(p_dong), trim(p_ho))
  on conflict (user_id) do update
     set complex_id = excluded.complex_id, name = excluded.name, phone = excluded.phone,
         dong = excluded.dong, ho = excluded.ho, status = 'pending', verified_at = null
   where public.pickup_helpers.status in ('pending','rejected');
  return (select status from public.pickup_helpers where user_id = auth.uid());
end $$;

-- [도우미] 맡을 수 있는 일감 — 호수·연락처는 맡기 전에는 보이지 않습니다.
create or replace function public.pickup_open_jobs()
returns table (id uuid, bag_size text, sort_mode text, bag_count smallint,
               pickup_date date, slot_start time, dong text, helper_fee integer)
language sql stable security definer set search_path = public as $$
  select r.id, r.bag_size, r.sort_mode, r.bag_count, r.pickup_date, r.slot_start, r.dong, r.helper_fee
    from public.pickup_requests r
   where r.complex_id = public.pickup_my_helper_complex()
     and r.status = 'requested'
     and r.user_id <> auth.uid()
     and r.pickup_date >= (now() at time zone 'Asia/Seoul')::date
   order by r.pickup_date, r.slot_start;
$$;

-- [도우미] 수락 — 먼저 누른 사람 한 명만 맡습니다.
create or replace function public.pickup_accept_job(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare my_complex uuid := public.pickup_my_helper_complex();
begin
  if my_complex is null then raise exception '승인된 도우미만 맡을 수 있어요.' using errcode = '42501'; end if;
  update public.pickup_requests
     set status = 'accepted', helper_id = auth.uid(), accepted_at = now()
   where id = p_id and complex_id = my_complex and status = 'requested' and user_id <> auth.uid();
  return found;
end $$;

-- [도우미] 맡은 일 — 배정된 건만, 문 앞 위치(동·호수)와 요청 메모를 봅니다. 손님 연락처는 보이지 않습니다.
create or replace function public.pickup_my_jobs()
returns table (id uuid, bag_size text, sort_mode text, bag_count smallint, pickup_date date,
               slot_start time, dong text, ho text, memo text, helper_fee integer,
               status text, done_at timestamptz, photo_path text)
language sql stable security definer set search_path = public as $$
  select r.id, r.bag_size, r.sort_mode, r.bag_count, r.pickup_date, r.slot_start,
         r.dong, case when r.status = 'accepted' then r.ho else null end,
         case when r.status = 'accepted' then r.memo else '' end,
         r.helper_fee, r.status, r.done_at, r.photo_path
    from public.pickup_requests r
   where r.helper_id = auth.uid() and r.status in ('accepted','done')
   order by (r.status = 'done'), r.pickup_date desc, r.slot_start desc
   limit 100;
$$;

-- [도우미] 못 하게 됐을 때 되돌리기
create or replace function public.pickup_release_job(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.pickup_requests set status = 'requested', helper_id = null, accepted_at = null
   where id = p_id and helper_id = auth.uid() and status = 'accepted';
  return found;
end $$;

-- [도우미] 완료 — 사진을 먼저 올리고 그 경로로 완료 처리
create or replace function public.pickup_complete_job(p_id uuid, p_photo text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_photo is null or split_part(p_photo, '/', 1) <> auth.uid()::text then
    raise exception '완료 사진을 올려 주세요.' using errcode = 'P0001';
  end if;
  update public.pickup_requests
     set status = 'done', done_at = now(), photo_path = p_photo,
         pay_status = case when charge > 0 then 'waiting' else 'none' end
   where id = p_id and helper_id = auth.uid() and status = 'accepted';
  return found;
end $$;

-- [도우미] 정산 조회 — 번 금액, 받은 금액, 남은 금액
create or replace function public.pickup_my_earnings()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'doneCount', (select count(*) from public.pickup_requests where helper_id = auth.uid() and status = 'done'),
    'earned',    (select coalesce(sum(helper_fee),0) from public.pickup_requests where helper_id = auth.uid() and status = 'done'),
    'paid',      (select coalesce(sum(amount),0) from public.pickup_payouts where helper_id = auth.uid()),
    'payouts',   coalesce((select json_agg(json_build_object('amount',amount,'period',period,'paidAt',paid_at) order by paid_at desc)
                             from public.pickup_payouts where helper_id = auth.uid()), '[]'::json)
  );
$$;

-- [관리자] 도우미별 정산 요약
create or replace function public.pickup_admin_settlement()
returns table (helper_id uuid, name text, done_count bigint, earned bigint, paid bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '관리자만 볼 수 있어요.' using errcode = '42501'; end if;
  return query
    select h.user_id, h.name,
           (select count(*) from public.pickup_requests r where r.helper_id = h.user_id and r.status = 'done'),
           (select coalesce(sum(r.helper_fee),0) from public.pickup_requests r where r.helper_id = h.user_id and r.status = 'done'),
           (select coalesce(sum(p.amount),0) from public.pickup_payouts p where p.helper_id = h.user_id)
      from public.pickup_helpers h
     order by h.name;
end $$;

-- 함수 실행 권한: 로그인한 사람만 (관리자 확인은 각 함수 안에서)
do $$
declare f text;
begin
  foreach f in array array[
    'pickup_my_helper_complex()',
    'pickup_create_request(uuid,text,text,int,date,time,text,text,text,text,int,int)',
    'pickup_cancel_request(uuid)',
    'pickup_helper_apply(uuid,text,text,text,text)',
    'pickup_open_jobs()', 'pickup_accept_job(uuid)', 'pickup_my_jobs()',
    'pickup_release_job(uuid)', 'pickup_complete_job(uuid,text)',
    'pickup_my_earnings()', 'pickup_admin_settlement()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8) 완료 사진 저장소 (비공개)
--    도우미는 자기 폴더(<내 id>/...)에만 올리고,
--    사진은 올린 도우미 · 그 신청의 손님 · 관리자만 볼 수 있습니다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pickup-photos', 'pickup-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pickup_photos_helper_upload on storage.objects;
create policy pickup_photos_helper_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'pickup-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.pickup_my_helper_complex() is not null
  );

drop policy if exists pickup_photos_read on storage.objects;
create policy pickup_photos_read on storage.objects
  for select to authenticated using (
    bucket_id = 'pickup-photos' and (
      public.is_owner()
      or (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.pickup_requests r
                  where r.photo_path = storage.objects.name and r.user_id = auth.uid())
    )
  );

drop policy if exists pickup_photos_owner_delete on storage.objects;
create policy pickup_photos_owner_delete on storage.objects
  for delete to authenticated using (bucket_id = 'pickup-photos' and public.is_owner());

commit;
