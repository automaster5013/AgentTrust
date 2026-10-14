import copy
import unittest
from stack_recovery_load_contract import admission_key,cohort,latency,version_ids,catalog_baseline


class RecoveryLoadContractTests(unittest.TestCase):
    def setUp(self):
        self.id='11111111-1111-4111-8111-111111111111'
        self.value={'schemaVersion':1,'cohortId':self.id,'mode':'verify','records':[{'index':i,'runId':'00000000-0000-4000-8000-'+format(i,'012x')} for i in range(20)]}

    def test_exact_twenty_records_bind_order_and_distinct_run_ids(self):
        self.assertIs(cohort(self.value),self.value)
        self.assertEqual(cohort({'schemaVersion':1,'cohortId':self.id,'mode':'admit','records':[]})['mode'],'admit')

    def test_short_duplicate_reordered_and_foreign_frame_refused(self):
        rows=[]
        value=copy.deepcopy(self.value);value['records'].pop();rows.append(value)
        value=copy.deepcopy(self.value);value['records'][1]['runId']=value['records'][0]['runId'];rows.append(value)
        value=copy.deepcopy(self.value);value['records'][0]['index']=1;rows.append(value)
        value=copy.deepcopy(self.value);value['records'][0]['index']=False;rows.append(value)
        value=copy.deepcopy(self.value);value['schemaVersion']=True;rows.append(value)
        value=copy.deepcopy(self.value);value['baseUrl']='https://other.example';rows.append(value)
        for value in rows:
            with self.assertRaises(ValueError):cohort(value)

    def test_admission_keys_are_stable_bounded_and_reject_unowned_indexes(self):
        keys=[admission_key(self.id,i) for i in range(20)]
        self.assertEqual(len(set(keys)),20);self.assertTrue(all(8<=len(k)<=100 for k in keys))
        self.assertEqual(keys[1],admission_key(self.id,1))
        for index in (-1,20,True,'1'):
            with self.assertRaises(ValueError):admission_key(self.id,index)

    def test_nearest_rank_percentiles_include_actual_outliers_without_dropping_samples(self):
        values=list(range(1,41));summary=latency(values)
        self.assertEqual(summary['p50Millis'],20);self.assertEqual(summary['p95Millis'],38);self.assertEqual(summary['maxMillis'],40)
        self.assertEqual(summary['samplesMillis'],values)
        values[-3:]=[1000,2000,3000];self.assertEqual(latency(values)['p95Millis'],1000)
        self.assertGreater(latency([500.0001]*40)['p95Millis'],500)

    def test_missing_nonfinite_negative_or_coerced_samples_refused(self):
        for bad in (list(range(39)),[0]*39+[float('nan')],[0]*39+[float('inf')],[0]*39+[-1],[0]*39+[True],[0]*39+['1']):
            with self.assertRaises(ValueError):latency(bad)

    def test_actual_scope_free_summary_projection_is_bound_to_every_scoped_detail(self):
        row={'id':self.id,'resource_key':'fixture-agent','version':1,'content_sha256':'a'*64,'created_at':'2026-10-15T00:00:00.123456Z'}
        owner={'organizationId':'own-org','projectId':'own-project'}
        detail={**row,'organization_id':'own-org','project_id':'own-project','definition':{}}
        self.assertEqual(version_ids([row]),[self.id])
        self.assertEqual(catalog_baseline([row],{self.id:detail},owner),[row])
        for details in ({},{self.id:{**detail,'organization_id':'foreign'}},{self.id:{**detail,'content_sha256':'b'*64}}):
            with self.assertRaises(ValueError):catalog_baseline([row],details,owner)

    def test_catalog_ids_cannot_inject_paths_and_summary_must_be_complete_bounded_and_unique(self):
        row={'id':self.id,'resource_key':'fixture-agent','version':1,'content_sha256':'a'*64,'created_at':'2026-10-15T00:00:00Z'}
        for rows in ([],[row,row],[{**row,'id':'../../other'}],[{**row,'version':True}],[{**row,'organization_id':'invented'}],[{**row,'created_at':'2026-10-15T00:00:00'}]):
            with self.assertRaises(ValueError):version_ids(rows)


if __name__=='__main__':unittest.main()
