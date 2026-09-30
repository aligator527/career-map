-- Anonymous, opt-in self-reported career data (Phase 6).
--
-- Privacy design (see docs/PRIVACY.md):
--   * The public (anon) key can only INSERT. It cannot read, update or delete rows.
--   * Rows hold coarse values only: age band (not age), rounded income, day of submission (no time),
--     no IP address, no free text, no identifiers except a SHA-256 hash of a random deletion code.
--   * Aggregates are computed nightly with the service-role key and published only for groups of 10+.
--   * A submitter can delete their row with the deletion code shown after submitting.

create table if not exists public.submissions (
  id bigint generated always as identity primary key,
  submitted_on date not null default current_date,
  country text not null check (country in ('JP', 'US', 'UK', 'CA', 'DE', 'FR', 'IT')),
  region text check (region is null or region ~ '^[A-Z0-9]{2,9}$'),
  occupation text check (occupation is null or occupation ~ '^[A-Za-z0-9]{1,8}$'),
  age_band text not null check (age_band in ('18-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69')),
  sex text check (sex in ('M', 'F')),
  education text check (education in ('secondary', 'short_tertiary', 'bachelor', 'graduate', 'lower_secondary', 'upper_secondary', 'tertiary')),
  employment text not null check (employment in ('regular', 'non_regular', 'self_employed', 'founder')),
  role_level text check (role_level in ('staff', 'lead', 'manager', 'director', 'executive')),
  english text check (english in ('none', 'basic', 'business', 'fluent', 'native')),
  remote text check (remote in ('none', 'hybrid', 'full')),
  changed_job_3y boolean,
  income integer not null,
  currency text not null check (currency in ('JPY', 'USD', 'GBP', 'CAD', 'EUR')),
  delete_token_hash text not null unique check (delete_token_hash ~ '^[0-9a-f]{64}$'),
  -- Income is rounded before submission (¥100,000 / 1,000 units) and must be plausible for a year's pay
  constraint income_rounded check ((currency = 'JPY' and income % 100000 = 0) or (currency <> 'JPY' and income % 1000 = 0)),
  constraint income_plausible check (
    (currency = 'JPY' and income between 500000 and 300000000)
    or (currency <> 'JPY' and income between 5000 and 3000000)
  )
);

alter table public.submissions enable row level security;

-- The public key may insert these columns only (id and submitted_on take their defaults).
revoke all on public.submissions from anon, authenticated;
grant insert (country, region, occupation, age_band, sex, education, employment, role_level, english, remote,
              changed_job_3y, income, currency, delete_token_hash)
  on public.submissions to anon;

drop policy if exists "anyone can submit" on public.submissions;
create policy "anyone can submit" on public.submissions for insert to anon with check (true);
-- No select/update/delete policies: anon cannot read or change anything.

-- ---------------------------------------------------------------- abuse limits
-- Timestamps for rate limiting live in a separate table with no link to submissions, pruned hourly.
create table if not exists public.submission_log (at timestamptz not null default now());
alter table public.submission_log enable row level security;
revoke all on public.submission_log from anon, authenticated;

create or replace function public.limit_submissions() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  delete from public.submission_log where at < now() - interval '1 day';
  if (select count(*) from public.submission_log where at > now() - interval '1 minute') >= 20 then
    raise exception 'too many submissions, try again later' using errcode = 'P0001';
  end if;
  if (select count(*) from public.submission_log) >= 2000 then
    raise exception 'daily submission limit reached' using errcode = 'P0001';
  end if;
  insert into public.submission_log default values;
  return new;
end $$;

drop trigger if exists limit_submissions on public.submissions;
create trigger limit_submissions before insert on public.submissions
  for each row execute function public.limit_submissions();

-- ---------------------------------------------------------------- deletion
-- Deletes the row whose deletion code hashes to the stored value. Returns whether a row was deleted.
create or replace function public.delete_submission(token text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if token is null or length(token) < 20 then
    return false;
  end if;
  delete from public.submissions where delete_token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.delete_submission(text) from public;
grant execute on function public.delete_submission(text) to anon;
revoke all on function public.limit_submissions() from public;
