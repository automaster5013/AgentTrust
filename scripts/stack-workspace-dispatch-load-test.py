import contextlib,copy,importlib.util,io,json,pathlib,tempfile,unittest,uuid
from unittest.mock import patch
from stack_workspace_onboarding import OnboardingRefused
spec=importlib.util.spec_from_file_location('dispatch_load',pathlib.Path(__file__).with_name('stack-workspace-dispatch-load.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Admin:
    def __init__(self,users):self.users=copy.deepcopy(users);self.calls=[]
    def request(self,path,method='GET'):
        self.calls.append((method,path))
        if path.startswith('/users?'):return [{'id':key} for key in self.users]
        actor=path.split('/')[2]
        if method=='DELETE':del self.users[actor];return
        if path.endswith('/role-mappings'):return {}
        return copy.deepcopy(self.users[actor])

def user(name):
    identifier,organization,project=[str(uuid.uuid4()) for _ in range(3)]
    row={'actorId':identifier,'username':name,'organizationId':organization,'projectId':project}
    stored={'id':identifier,'username':name,'attributes':{'agenttrust_organization':[organization],'agenttrust_project':[project]}}
    return row,stored

class LoadControls(unittest.TestCase):
    def test_default_plan_contacts_no_provider_or_docker_and_creates_no_business_rows(self):
        output=io.StringIO()
        with patch('sys.argv',['load']),patch.object(module,'command') as command,patch.object(module,'IdentityAdmin') as provider,contextlib.redirect_stdout(output):code=module.main()
        self.assertEqual(code,0);command.assert_not_called();provider.assert_not_called()
        value=json.loads(output.getvalue());self.assertEqual(value['plannedWorkspaces'],10);self.assertEqual(value['plannedSyntheticEvaluations'],50)
        self.assertFalse(value['businessWritesPerformed'] or value['workerInterruptionPerformed'] or value['providerContactPerformed'])

    def test_explicit_mutation_flag_outside_disposable_ci_is_refused_before_provider_or_worker(self):
        with tempfile.TemporaryDirectory(prefix='dispatch-guard-',dir=module.ROOT/'.local') as outer:
            root=pathlib.Path(outer);(root/'.local').mkdir();output=io.StringIO()
            with patch.object(module,'ROOT',root),patch.dict(module.os.environ,{'GITHUB_ACTIONS':'false','CI':'true'}),patch('sys.argv',['load','--allow-owned-evaluations']),patch.object(module,'command') as command,patch.object(module,'IdentityAdmin') as provider,contextlib.redirect_stdout(output):code=module.main()
            self.assertEqual(code,1);command.assert_not_called();provider.assert_not_called()
            summary=json.loads(output.getvalue());report=json.loads(pathlib.Path(summary['reportPath']).read_text())
            self.assertFalse(report['completed']);self.assertEqual(report['code'],'WORKSPACE_LOAD_REQUIRES_DISPOSABLE_CI')
            self.assertFalse(report['businessWritesPerformed'] or report['workerInterruptionPerformed'])

    def test_ten_scopes_span_two_organizations_and_unsigned_uuid_boundary(self):
        rows=module.manifests();self.assertEqual(len(rows),10)
        self.assertEqual(len({r['organizationId'] for r in rows}),2);self.assertEqual(len({r['projectId'] for r in rows}),10)
        self.assertTrue(rows[0]['organizationId'].startswith('7fff'));self.assertTrue(rows[5]['organizationId'].startswith('8000'))
        self.assertEqual(len({r['members'][0]['username'] for r in rows}),10)

    def test_broker_state_requires_exact_stream_and_bounded_nonnegative_integer_counts(self):
        stream={'name':'STACK_EVALUATIONS','created':'fixture-time','state':{'messages':50,'last_seq':70}}
        def frame(value):return json.dumps({'account_details':[{'stream_detail':value}]}).encode()
        self.assertEqual(module.stream_metadata(frame([stream]))['messages'],50)
        for rows in [[],[stream,stream]]:
            with self.assertRaises(OnboardingRefused):module.stream_metadata(frame(rows))
        for count in [-1,True,2**64]:
            changed=copy.deepcopy(stream);changed['state']['messages']=count
            with self.assertRaises(OnboardingRefused):module.stream_metadata(frame([changed]))
        with self.assertRaises(OnboardingRefused):module.stream_metadata(b' '*65537)

    def test_cleanup_preflights_every_identity_before_any_delete(self):
        first,a=user('owned-one');second,b=user('owned-two');admin=Admin({first['actorId']:a,second['actorId']:b})
        second['projectId']=str(uuid.uuid4())
        with self.assertRaises(OnboardingRefused):module.cleanup_owned(admin,{},[first,second])
        self.assertTrue(all(method=='GET' for method,path in admin.calls));self.assertEqual(len(admin.users),2)

    def test_cleanup_refuses_original_actor_even_if_a_supplied_record_matches(self):
        row,stored=user('original-user');admin=Admin({row['actorId']:stored});original=module.account_fingerprints(admin);admin.calls=[]
        with self.assertRaises(OnboardingRefused):module.cleanup_owned(admin,original,[row])
        self.assertFalse(admin.calls);self.assertEqual(len(admin.users),1)

    def test_cleanup_deletes_only_known_created_identities_and_preserves_original_rows(self):
        initial,stored=user('original-user');owned,created=user('owned-user');admin=Admin({initial['actorId']:stored});original=module.account_fingerprints(admin)
        admin.users[owned['actorId']]=created;module.cleanup_owned(admin,original,[owned])
        self.assertEqual(admin.users,{initial['actorId']:stored});self.assertEqual([path for method,path in admin.calls if method=='DELETE'],['/users/'+owned['actorId']])

if __name__=='__main__':unittest.main()
