"""Database-enforced tenant and append-only boundaries; every test rolls back."""
import json,pathlib,subprocess,uuid
root=pathlib.Path(__file__).resolve().parent.parent
def run(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs).stdout
try:
 state=json.loads(run(['docker','inspect','agenttrust-stack-db-1']))[0]
 assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 rows=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));own=next(x for x in rows if x['username']=='demo-admin');foreign=next(x for x in rows if x['username']=='other-admin')
 for row in [own,foreign]:
  for key in ['organizationId','projectId','actorId']:assert str(uuid.UUID(row[key]))==row[key]
 sql=f"""
 BEGIN;
 SET LOCAL ROLE agenttrust_stack_api;
 SELECT set_config('agenttrust.organization_id','{own['organizationId']}',true);
 SELECT set_config('agenttrust.project_id','{own['projectId']}',true);
 DO $$
 DECLARE own_run UUID; foreign_visible INTEGER;
 BEGIN
   SELECT id INTO own_run FROM stack_runs LIMIT 1;
   IF own_run IS NULL THEN RAISE EXCEPTION 'No synthetic test run'; END IF;
   SELECT count(*) INTO foreign_visible FROM stack_runs WHERE organization_id='{foreign['organizationId']}';
   IF foreign_visible <> 0 THEN RAISE EXCEPTION 'Foreign rows visible'; END IF;
   SELECT count(*) INTO foreign_visible FROM stack_run_results WHERE organization_id='{foreign['organizationId']}';
   IF foreign_visible <> 0 THEN RAISE EXCEPTION 'Foreign completions visible'; END IF;
   SELECT count(*) INTO foreign_visible FROM stack_evidence_archives WHERE organization_id='{foreign['organizationId']}';
   IF foreign_visible <> 0 THEN RAISE EXCEPTION 'Foreign archives visible'; END IF;
   SELECT count(*) INTO foreign_visible FROM stack_rule_vectors WHERE organization_id='{foreign['organizationId']}';
   IF foreign_visible <> 0 THEN RAISE EXCEPTION 'Foreign vectors visible'; END IF;
   BEGIN
     UPDATE stack_rule_vectors SET content_sha256=repeat('a',64) WHERE run_id=own_run;
     RAISE EXCEPTION 'Vector update permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     DELETE FROM stack_rule_vectors WHERE run_id=own_run;
     RAISE EXCEPTION 'Vector deletion permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     UPDATE stack_evidence_archives SET content_sha256=repeat('a',64) WHERE run_id=own_run;
     RAISE EXCEPTION 'Archive update permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     DELETE FROM stack_evidence_archives WHERE run_id=own_run;
     RAISE EXCEPTION 'Archive deletion permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     UPDATE stack_run_results SET decision='pass' WHERE run_id=own_run;
     RAISE EXCEPTION 'Completion update permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     UPDATE stack_runs SET decision='pass' WHERE id=own_run;
     RAISE EXCEPTION 'Immutable result update permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     DELETE FROM stack_runs WHERE id=own_run;
     RAISE EXCEPTION 'Run deletion permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id)
       VALUES(gen_random_uuid(),'{foreign['organizationId']}','{foreign['projectId']}','{own['actorId']}','boundary.test',own_run);
     RAISE EXCEPTION 'Cross-scope insert permitted';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
     INSERT INTO stack_reviews(id,run_id,organization_id,project_id,actor_id,decision,reason)
       VALUES(gen_random_uuid(),gen_random_uuid(),'{own['organizationId']}','{own['projectId']}','{own['actorId']}','approved','Synthetic nonexistent run');
     RAISE EXCEPTION 'Missing scoped run accepted';
   EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 END $$;
 DO $$
 DECLARE item TEXT; own_key UUID := gen_random_uuid(); next_revision BIGINT;
 BEGIN
  FOREACH item IN ARRAY ARRAY['stack_project_settings','stack_access_keys','stack_access_key_revocations'] LOOP
   IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=item::regclass) THEN RAISE EXCEPTION 'Workspace RLS missing'; END IF;
   IF has_table_privilege(current_user,item,'UPDATE') OR has_table_privilege(current_user,item,'DELETE') THEN RAISE EXCEPTION 'Workspace mutation privilege widened'; END IF;
  END LOOP;
  SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM stack_project_settings;
  INSERT INTO stack_project_settings(organization_id,project_id,revision,actor_id,name,description) VALUES('{own['organizationId']}','{own['projectId']}',next_revision,'{own['actorId']}','Synthetic rollback test','');
  INSERT INTO stack_access_keys(id,organization_id,project_id,actor_id,name,secret_hash,expires_at) VALUES(own_key,'{own['organizationId']}','{own['projectId']}','{own['actorId']}','Synthetic key',repeat('a',64),now()+interval '1 day');
  BEGIN
   INSERT INTO stack_project_settings(organization_id,project_id,revision,actor_id,name,description) VALUES('{foreign['organizationId']}','{foreign['projectId']}',1,'{own['actorId']}','Forbidden','');
   RAISE EXCEPTION 'Foreign project settings permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   INSERT INTO stack_access_key_revocations(key_id,organization_id,project_id,actor_id) VALUES(own_key,'{foreign['organizationId']}','{foreign['projectId']}','{own['actorId']}');
   RAISE EXCEPTION 'Foreign key revocation permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO stack_access_key_revocations(key_id,organization_id,project_id,actor_id) VALUES(own_key,'{own['organizationId']}','{own['projectId']}','{own['actorId']}');
  BEGIN DELETE FROM stack_access_keys WHERE id=own_key; RAISE EXCEPTION 'Key deletion permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END $$;
 ROLLBACK;
 """
 run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1'],input=sql)
 print(json.dumps({'completed':True,'database':'agenttrust_stack','checks':['workspace RLS forced, append-only grants and cross-scope management refusal','RLS foreign rows invisible','result update refused','run deletion refused','cross-scope insert refused','scoped review foreign key enforced','archive scope and immutable metadata enforced','vector RLS and immutable metadata enforced'],'testWritesRolledBack':True,'legacyDatabaseChanged':False}))
except Exception:
 print(json.dumps({'completed':False,'code':'DATABASE_BOUNDARY_UNVERIFIED'}));raise SystemExit(1)
