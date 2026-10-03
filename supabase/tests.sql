-- Security and behavior checks for schema.sql, run as the public anon role.
-- Local run (Docker):
--   docker run -d --name cue-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16-alpine
--   docker exec -i cue-pg psql -U postgres -c "create role anon nologin; create role authenticated nologin;"
--   docker exec -i cue-pg psql -U postgres < supabase/schema.sql
--   docker exec -i cue-pg psql -U postgres < supabase/tests.sql
-- Expected: every direct table or helper call errors with "permission denied"; the API behaves as labeled.
\set ON_ERROR_STOP 0
set role anon;
\echo '--- direct table access must fail'
select count(*) from cue_contacts;
select count(*) from cue_events;
insert into cue_votes values (gen_random_uuid(),'x','y',1);
\echo '--- helpers must not be callable'
select cue_host('X','Y');
select cue_live('X');
\echo '--- host start'
select (cue_host_start('ai-zero-to-sixty','AI, Zero to Sixty', true))::jsonb as ev \gset
select :'ev'::jsonb->>'code' as code, :'ev'::jsonb->>'host_key' as key \gset
\echo code=:code
\echo '--- join (normal, profane name, bad client)'
select cue_join(:'code','client-aaaa','Joel','🦊');
select cue_join(:'code','client-bbbb','fuck you','💩');
select cue_join(:'code','short','x','');
select cue_join('NOPE00','client-cccc','A','');
\echo '--- not joined cannot vote'
select cue_vote(:'code','client-zzzz','poll1',1);
\echo '--- votes and revote'
select cue_vote(:'code','client-aaaa','poll1',2);
select cue_vote(:'code','client-aaaa','poll1',1);
select cue_vote(:'code','client-bbbb','poll1',1);
select cue_vote(:'code','client-bbbb','poll1',99);
\echo '--- words: dupes, limit 3, profanity filtered'
select cue_add_words(:'code','client-aaaa','feel',array['Curious','curious!','Excited','shit','Nervous','Extra'],3);
select cue_add_words(:'code','client-bbbb','feel',array['curious','Scared'],3);
select cue_results(:'code','feel');
select cue_results(:'code','poll1');
\echo '--- wall masks flagged names'
select cue_wall(:'code');
\echo '--- questions: normal, filtered, short, limit'
select (cue_ask(:'code','client-aaaa','What model should a small business start with?'))::jsonb->>'id' as q1 \gset
select cue_ask(:'code','client-bbbb','How do I kill a process?');
select cue_ask(:'code','client-aaaa','Hi');
select cue_upvote(:'code','client-bbbb',:'q1');
select cue_upvote(:'code','client-bbbb',:'q1');
select cue_questions_public(:'code','client-bbbb');
\echo '--- host functions need the key'
select cue_host_questions(:'code','wrong-key');
select cue_host_questions(:'code',:'key');
select cue_host_question(:'code',:'key',:'q1'::uuid,null,true);
select (cue_questions_public(:'code'))::jsonb->>'featured' = :'q1' as featured_ok;
\echo '--- contacts: validation and write-only'
select cue_follow_up(:'code','client-aaaa','Joel','joel@example.com',null,true,false,'Email me the slides');
select cue_follow_up(:'code','client-bbbb','B','not-an-email',null,true,false,'x');
select cue_follow_up(:'code','client-bbbb','B',null,'(505) 555-0100',false,true,'Text me');
select (cue_host_export(:'code',:'key'))::jsonb->'contacts';
select cue_host_export(:'code','nope');
\echo '--- filter off (law enforcement override)'
select cue_host_set(:'code',:'key',false,null,false);
select cue_ask(:'code','client-bbbb','How do I kill a process?');
\echo '--- end event, then audience calls fail'
select cue_host_set(:'code',:'key',null,null,true);
select cue_join(:'code','client-aaaa','Joel','🦊');
