-- ============================================================
-- TOEIC学習アプリ — Supabase セットアップSQL
-- Supabaseの「SQL Editor」にこの内容を全部貼り付けて「Run」するだけ
-- ============================================================

-- 1) テーブル作成 --------------------------------------------------

-- ユーザー（ID＋パスワードハッシュ）
create table if not exists public.users (
  uid        text primary key,
  pw_hash    text not null,
  last_login bigint,
  created_at timestamptz default now()
);
-- 既存テーブルにも last_login 列を追加（既にあれば何もしない）
alter table public.users add column if not exists last_login bigint;

-- 学習進捗（ユーザー×問題ごとに1行）
create table if not exists public.progress (
  uid           text not null,
  qid           text not null,
  level         int  default 0,
  correct_count int  default 0,
  wrong_count   int  default 0,
  next_review   bigint,
  last_reviewed bigint,
  first_studied bigint,
  primary key (uid, qid)
);

-- 学習履歴（解答1回ごとに1行）
create table if not exists public.history (
  id      bigint generated always as identity primary key,
  uid     text not null,
  ts      bigint,
  qid     text,
  correct boolean
);

create index if not exists history_uid_idx on public.history (uid);

-- 2) Row Level Security（行レベルセキュリティ）を有効化 ----------------
alter table public.users    enable row level security;
alter table public.progress enable row level security;
alter table public.history  enable row level security;

-- 3) anon(公開)キーに許可する操作を定義 ----------------------------
--    このアプリはアプリ側でID/パスワード認証を行うため、
--    anonロールに読み書きを許可する（公開キーで操作可能にする）。
--    ※将来さらに厳格化したい場合はポリシーを調整可能。

-- users
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to anon using (true);
drop policy if exists users_insert on public.users;
create policy users_insert on public.users for insert to anon with check (true);
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to anon using (true) with check (true);
drop policy if exists users_delete on public.users;
create policy users_delete on public.users for delete to anon using (true);

-- progress
drop policy if exists progress_select on public.progress;
create policy progress_select on public.progress for select to anon using (true);
drop policy if exists progress_insert on public.progress;
create policy progress_insert on public.progress for insert to anon with check (true);
drop policy if exists progress_update on public.progress;
create policy progress_update on public.progress for update to anon using (true) with check (true);
drop policy if exists progress_delete on public.progress;
create policy progress_delete on public.progress for delete to anon using (true);

-- history
drop policy if exists history_select on public.history;
create policy history_select on public.history for select to anon using (true);
drop policy if exists history_insert on public.history;
create policy history_insert on public.history for insert to anon with check (true);
drop policy if exists history_delete on public.history;
create policy history_delete on public.history for delete to anon using (true);

-- 完了！
