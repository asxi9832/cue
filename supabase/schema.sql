-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Rampant LLC
--
-- Cue audience schema: attendees, polls, word clouds, Q&A and follow-up contacts.
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run. Safe to re-run.
--
-- Security model: every table has row-level security on and NO policies, so the public
-- "anon" key cannot read or write tables directly. All access goes through the functions
-- below. Audience functions can only add data and read aggregates. Host functions need the
-- event's host key, which only the presenting screen holds. Contacts are never returned
-- to anyone except a host export.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists cue_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_hash text not null,
  deck text not null default '',
  title text not null default '',
  filter boolean not null default true,        -- automatic moderation (profanity, violence)
  auto_approve boolean not null default true,  -- questions that pass the filter go live
  featured uuid,                               -- question shown on the big screen
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists cue_attendees (
  event_id uuid not null references cue_events(id) on delete cascade,
  client_id text not null,
  name text not null,
  emoji text not null default '',
  flagged boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (event_id, client_id)
);

create table if not exists cue_votes (
  event_id uuid not null references cue_events(id) on delete cascade,
  interaction text not null,
  client_id text not null,
  choice int not null,
  at timestamptz not null default now(),
  primary key (event_id, interaction, client_id)
);

create table if not exists cue_words (
  event_id uuid not null references cue_events(id) on delete cascade,
  interaction text not null,
  client_id text not null,
  word text not null,
  norm text not null,
  flagged boolean not null default false,
  at timestamptz not null default now(),
  primary key (event_id, interaction, client_id, norm)
);

create table if not exists cue_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references cue_events(id) on delete cascade,
  client_id text not null,
  name text not null default '',
  emoji text not null default '',
  body text not null,
  status text not null default 'approved' check (status in ('pending', 'approved', 'hidden', 'answered')),
  flagged boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists cue_questions_event on cue_questions(event_id);

create table if not exists cue_question_votes (
  question_id uuid not null references cue_questions(id) on delete cascade,
  client_id text not null,
  primary key (question_id, client_id)
);

create table if not exists cue_contacts (
  event_id uuid not null references cue_events(id) on delete cascade,
  client_id text not null,
  name text not null default '',
  email text,
  phone text,
  consent_email boolean not null default false,
  consent_sms boolean not null default false,
  consent_text text not null default '',
  at timestamptz not null default now(),
  primary key (event_id, client_id)
);

create table if not exists cue_blocklist (term text primary key);

do $$ declare t text; begin
  foreach t in array array['cue_events','cue_attendees','cue_votes','cue_words','cue_questions','cue_question_votes','cue_contacts','cue_blocklist'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers (not callable by the public)
create or replace function cue_norm(t text) returns text language sql immutable as $$
  select left(lower(regexp_replace(trim(coalesce(t, '')), '[^[:alnum:][:space:]''-]', '', 'g')), 30)
$$;

-- Whole-word match against the blocklist, after lowercasing and stripping punctuation.
create or replace function cue_blocked(t text) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from cue_blocklist b
    where (' ' || regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g') || ' ') like ('% ' || b.term || ' %')
  )
$$;

create or replace function cue_live(p_code text) returns cue_events language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events;
begin
  select * into e from cue_events where code = upper(trim(p_code)) and ended_at is null;
  if e.id is null then raise exception 'Event not found or ended' using errcode = 'P0002'; end if;
  return e;
end $$;

create or replace function cue_host(p_code text, p_key text) returns cue_events language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events;
begin
  select * into e from cue_events where code = upper(trim(p_code));
  if e.id is null or e.host_hash <> encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return e;
end $$;

create or replace function cue_check_client(p_client text) returns void language plpgsql immutable as $$
begin
  if p_client is null or length(p_client) < 8 or length(p_client) > 64 then
    raise exception 'Invalid client' using errcode = '22023';
  end if;
end $$;

create or replace function cue_member(p_event uuid, p_client text) returns cue_attendees language plpgsql stable security definer set search_path = public, extensions as $$
declare a cue_attendees;
begin
  select * into a from cue_attendees where event_id = p_event and client_id = p_client;
  if a.client_id is null then raise exception 'Join first' using errcode = '42501'; end if;
  return a;
end $$;

-- ---------------------------------------------------------------- host (presenting screen)
create or replace function cue_host_start(p_deck text, p_title text, p_filter boolean default true)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  k text := encode(gen_random_bytes(24), 'hex');
  alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text; i int; b bytea;
begin
  if coalesce(trim(p_deck), '') = '' then raise exception 'Deck required' using errcode = '22023'; end if;
  loop
    b := gen_random_bytes(6); c := '';
    for i in 0..5 loop c := c || substr(alpha, 1 + (get_byte(b, i) % 31), 1); end loop;
    exit when not exists (select 1 from cue_events where code = c);
  end loop;
  insert into cue_events (code, host_hash, deck, title, filter)
  values (c, encode(digest(k, 'sha256'), 'hex'), left(trim(p_deck), 80), left(coalesce(p_title, ''), 200), coalesce(p_filter, true));
  return json_build_object('code', c, 'host_key', k);
end $$;

create or replace function cue_host_set(p_code text, p_key text, p_filter boolean default null, p_auto boolean default null, p_end boolean default false)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_host(p_code, p_key);
begin
  update cue_events set
    filter = coalesce(p_filter, filter),
    auto_approve = coalesce(p_auto, auto_approve),
    ended_at = case when p_end then now() else ended_at end
  where id = e.id;
  return json_build_object('ok', true);
end $$;

create or replace function cue_host_questions(p_code text, p_key text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events := cue_host(p_code, p_key);
begin
  return json_build_object('featured', e.featured, 'items', coalesce((
    select json_agg(q order by q.votes desc, q.at) from (
      select qq.id, qq.body, qq.name, qq.emoji, qq.status, qq.flagged, qq.at,
             (select count(*) from cue_question_votes v where v.question_id = qq.id)::int as votes
      from cue_questions qq where qq.event_id = e.id
    ) q), '[]'::json));
end $$;

create or replace function cue_host_question(p_code text, p_key text, p_id uuid, p_status text default null, p_feature boolean default null)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_host(p_code, p_key);
begin
  if p_status is not null then
    update cue_questions set status = p_status where id = p_id and event_id = e.id;
  end if;
  if p_feature is true then update cue_events set featured = p_id where id = e.id;
  elsif p_feature is false then update cue_events set featured = null where id = e.id and featured = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- Everything for one event, for the post-event report and CSV export.
create or replace function cue_host_export(p_code text, p_key text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events := cue_host(p_code, p_key);
begin
  return json_build_object(
    'event', json_build_object('code', e.code, 'deck', e.deck, 'title', e.title, 'created_at', e.created_at, 'ended_at', e.ended_at),
    'attendees', coalesce((select json_agg(json_build_object('name', name, 'emoji', emoji, 'flagged', flagged, 'joined_at', joined_at) order by joined_at) from cue_attendees where event_id = e.id), '[]'::json),
    'contacts', coalesce((select json_agg(json_build_object('name', name, 'email', email, 'phone', phone, 'consent_email', consent_email, 'consent_sms', consent_sms, 'consent_text', consent_text, 'at', at) order by at) from cue_contacts where event_id = e.id), '[]'::json),
    'votes', coalesce((select json_agg(json_build_object('interaction', interaction, 'choice', choice, 'count', n)) from (select interaction, choice, count(*)::int n from cue_votes where event_id = e.id group by 1, 2) v), '[]'::json),
    'words', coalesce((select json_agg(json_build_object('interaction', interaction, 'word', norm, 'count', n, 'flagged', f)) from (select interaction, norm, count(*)::int n, bool_or(flagged) f from cue_words where event_id = e.id group by 1, 2) w), '[]'::json),
    'questions', coalesce((select json_agg(json_build_object('body', body, 'name', name, 'status', status, 'flagged', flagged, 'votes', (select count(*) from cue_question_votes v where v.question_id = q.id)) order by at) from cue_questions q where event_id = e.id), '[]'::json)
  );
end $$;

-- ---------------------------------------------------------------- audience (phones)
create or replace function cue_join(p_code text, p_client text, p_name text, p_emoji text)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code); n text := left(trim(coalesce(p_name, '')), 40); f boolean;
begin
  perform cue_check_client(p_client);
  if n = '' then raise exception 'Name required' using errcode = '22023'; end if;
  f := e.filter and cue_blocked(n);
  insert into cue_attendees (event_id, client_id, name, emoji, flagged)
  values (e.id, p_client, n, left(coalesce(p_emoji, ''), 16), f)
  on conflict (event_id, client_id) do update set name = excluded.name, emoji = excluded.emoji, flagged = excluded.flagged;
  return json_build_object('title', e.title, 'deck', e.deck, 'name', case when f then 'Guest' else n end);
end $$;

create or replace function cue_vote(p_code text, p_client text, p_interaction text, p_choice int)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code);
begin
  perform cue_check_client(p_client);
  perform cue_member(e.id, p_client);
  if p_choice is null or p_choice < 0 or p_choice > 19 then raise exception 'Invalid choice' using errcode = '22023'; end if;
  insert into cue_votes (event_id, interaction, client_id, choice) values (e.id, left(p_interaction, 60), p_client, p_choice)
  on conflict (event_id, interaction, client_id) do update set choice = excluded.choice, at = now();
  return json_build_object('ok', true);
end $$;

create or replace function cue_add_words(p_code text, p_client text, p_interaction text, p_words text[], p_max int default 3)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code); w text; nrm text; have int; added int := 0; blocked int := 0;
begin
  perform cue_check_client(p_client);
  perform cue_member(e.id, p_client);
  foreach w in array coalesce(p_words, array[]::text[]) loop
    nrm := cue_norm(w);
    continue when nrm = '';
    select count(*) into have from cue_words where event_id = e.id and interaction = p_interaction and client_id = p_client;
    exit when have >= least(greatest(coalesce(p_max, 3), 1), 10);
    insert into cue_words (event_id, interaction, client_id, word, norm, flagged)
    values (e.id, left(p_interaction, 60), p_client, left(trim(w), 30), nrm, e.filter and cue_blocked(nrm))
    on conflict do nothing;
    if found then added := added + 1; if e.filter and cue_blocked(nrm) then blocked := blocked + 1; end if; end if;
  end loop;
  return json_build_object('added', added, 'filtered', blocked);
end $$;

create or replace function cue_ask(p_code text, p_client text, p_body text)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code); a cue_attendees; b text := left(trim(coalesce(p_body, '')), 280); f boolean; st text; qid uuid;
begin
  perform cue_check_client(p_client);
  a := cue_member(e.id, p_client);
  if length(b) < 3 then raise exception 'Question too short' using errcode = '22023'; end if;
  if (select count(*) from cue_questions where event_id = e.id and client_id = p_client) >= 5 then
    raise exception 'Question limit reached' using errcode = '22023';
  end if;
  f := e.filter and cue_blocked(b);
  st := case when f then 'hidden' when e.auto_approve then 'approved' else 'pending' end;
  insert into cue_questions (event_id, client_id, name, emoji, body, status, flagged)
  values (e.id, p_client, case when a.flagged then 'Guest' else a.name end, a.emoji, b, st, f)
  returning id into qid;
  return json_build_object('id', qid, 'status', case when f then 'pending' else st end); -- never tell the sender it was filtered
end $$;

create or replace function cue_upvote(p_code text, p_client text, p_question uuid)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code);
begin
  perform cue_check_client(p_client);
  perform cue_member(e.id, p_client);
  if not exists (select 1 from cue_questions where id = p_question and event_id = e.id and status in ('approved', 'answered')) then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  insert into cue_question_votes (question_id, client_id) values (p_question, p_client) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function cue_follow_up(p_code text, p_client text, p_name text, p_email text, p_phone text,
                                         p_consent_email boolean, p_consent_sms boolean, p_consent_text text)
returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code); em text := nullif(lower(trim(coalesce(p_email, ''))), ''); ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  perform cue_check_client(p_client);
  if em is null and ph is null then raise exception 'Email or phone required' using errcode = '22023'; end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email' using errcode = '22023'; end if;
  if ph is not null and length(regexp_replace(ph, '[^0-9]', '', 'g')) not between 7 and 15 then raise exception 'Invalid phone' using errcode = '22023'; end if;
  insert into cue_contacts (event_id, client_id, name, email, phone, consent_email, consent_sms, consent_text)
  values (e.id, p_client, left(trim(coalesce(p_name, '')), 80), left(em, 200), left(ph, 20),
          coalesce(p_consent_email, false), coalesce(p_consent_sms, false) and ph is not null, left(coalesce(p_consent_text, ''), 500))
  on conflict (event_id, client_id) do update set name = excluded.name, email = excluded.email, phone = excluded.phone,
    consent_email = excluded.consent_email, consent_sms = excluded.consent_sms, consent_text = excluded.consent_text, at = now();
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- public reads (aggregates only)
create or replace function cue_wall(p_code text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code);
begin
  return json_build_object(
    'title', e.title,
    'count', (select count(*) from cue_attendees where event_id = e.id),
    'recent', coalesce((select json_agg(x) from (
      select case when flagged then 'Guest' else name end as name, emoji from cue_attendees
      where event_id = e.id order by joined_at desc limit 60) x), '[]'::json));
end $$;

create or replace function cue_results(p_code text, p_interaction text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code);
begin
  return json_build_object(
    'votes', coalesce((select json_agg(json_build_object('choice', choice, 'count', n)) from (
      select choice, count(*)::int n from cue_votes where event_id = e.id and interaction = p_interaction group by choice) v), '[]'::json),
    'words', coalesce((select json_agg(json_build_object('word', norm, 'count', n) order by n desc, norm) from (
      select norm, count(*)::int n from cue_words where event_id = e.id and interaction = p_interaction and not flagged
      group by norm order by count(*) desc, norm limit 40) w), '[]'::json));
end $$;

create or replace function cue_questions_public(p_code text, p_client text default null)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare e cue_events := cue_live(p_code);
begin
  return json_build_object('featured', e.featured, 'items', coalesce((
    select json_agg(q order by q.votes desc, q.at) from (
      select qq.id, qq.body, qq.name, qq.emoji, qq.status, qq.at,
             (select count(*) from cue_question_votes v where v.question_id = qq.id)::int as votes,
             exists (select 1 from cue_question_votes v where v.question_id = qq.id and v.client_id = p_client) as mine
      from cue_questions qq where qq.event_id = e.id and qq.status in ('approved', 'answered')
      order by votes desc, qq.at limit 50) q), '[]'::json));
end $$;

-- ---------------------------------------------------------------- permissions
do $$ declare f text; begin
  -- helpers: nobody outside the database calls these
  foreach f in array array['cue_blocked(text)', 'cue_live(text)', 'cue_host(text,text)', 'cue_member(uuid,text)', 'cue_check_client(text)', 'cue_norm(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- the API
  foreach f in array array[
    'cue_host_start(text,text,boolean)', 'cue_host_set(text,text,boolean,boolean,boolean)', 'cue_host_questions(text,text)',
    'cue_host_question(text,text,uuid,text,boolean)', 'cue_host_export(text,text)',
    'cue_join(text,text,text,text)', 'cue_vote(text,text,text,int)', 'cue_add_words(text,text,text,text[],int)',
    'cue_ask(text,text,text)', 'cue_upvote(text,text,uuid)',
    'cue_follow_up(text,text,text,text,text,boolean,boolean,text)',
    'cue_wall(text)', 'cue_results(text,text)', 'cue_questions_public(text,text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- blocklist
-- Whole words only. Extend it any time: insert into cue_blocklist values ('word') on conflict do nothing;
-- A cartridge can turn filtering off ("filter": false), for example for a law enforcement training.
insert into cue_blocklist (term) values
  ('fuck'),('fucking'),('fucker'),('motherfucker'),('shit'),('shitty'),('bullshit'),('bitch'),('bitches'),('bastard'),
  ('asshole'),('ass'),('dick'),('dickhead'),('cock'),('cunt'),('pussy'),('twat'),('wanker'),('prick'),('slut'),('whore'),
  ('piss'),('crap'),('damn'),('goddamn'),('douche'),('douchebag'),('jackass'),('dumbass'),('retard'),('retarded'),
  ('nigger'),('nigga'),('faggot'),('fag'),('dyke'),('tranny'),('spic'),('chink'),('kike'),('wetback'),('gook'),('raghead'),
  ('porn'),('porno'),('nude'),('nudes'),('sex'),('horny'),('rape'),('rapist'),('molest'),
  ('kill'),('killing'),('murder'),('shoot'),('shooting'),('stab'),('bomb'),('bombing'),('terrorist'),('massacre'),
  ('suicide'),('kys'),('nazi'),('hitler'),('isis')
on conflict do nothing;
