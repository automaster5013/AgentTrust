import copy
import json
import pathlib
import unittest
from connector_evaluator import definition_case, evaluate, sample, flat_schema, validate_sample

def cases():
    local = pathlib.Path(__file__).with_name('connector-cases.json')
    source = local if local.exists() else pathlib.Path(__file__).resolve().parents[2] / 'tools/promptfoo/connector-cases.json'
    return json.loads(source.read_text(encoding='utf-8'))['cases']

class ConnectorEvaluationTests(unittest.TestCase):
    def test_five_original_sample_rules_are_really_evaluated(self):
        results = [evaluate(sample(c)) for c in cases()]
        self.assertEqual(5, sum(len(r['rules']) for r in results))
        self.assertEqual(['pass', 'pass'], [r['decision'] for r in results])
        self.assertTrue(all(rule['status'] == 'pass' for result in results for rule in result['rules']))

    def test_forbidden_tool_and_bad_arguments_fail_required_rule(self):
        for change in [{'name': 'transfer_funds', 'args': {}}, {'name': 'lookup_order', 'args': {}},
                       {'name': 'lookup_order', 'args': {'orderId': 'x', 'extra': 'not-allowed'}}]:
            c = cases()[0]
            c['evidence']['toolEvents'] = [change]
            result = evaluate(sample(c))
            self.assertEqual('block', result['decision'])
            self.assertEqual('fail', result['rules'][2]['status'])

    def test_missing_malformed_and_empty_observations_are_distinct(self):
        for events, status in [(None, 'inconclusive'), ([{'name': None, 'args': {}}], 'inconclusive'),
                               ([{'name': 'lookup_order', 'args': None}], 'inconclusive'), ([], 'pass')]:
            c = cases()[0]; c['evidence']['toolEvents'] = events
            self.assertEqual(status, evaluate(sample(c))['rules'][2]['status'])
        c = cases()[1]; c['evidence']['output'] = None
        self.assertEqual('inconclusive', evaluate(sample(c))['rules'][0]['status'])
        c['evidence']['output'] = ''
        self.assertEqual('fail', evaluate(sample(c))['rules'][0]['status'])

    def test_json_shape_wrong_type_extra_missing_and_duplicate_keys_fail(self):
        for output in ['not json', '[]', 'null', '{"status":1}', '{}', '{"status":"wrong"}',
                       '{"status":"review_required","extra":"x"}', '{"status":"wrong","status":"review_required"}',
                       '{"status":"wrong","st\\u0061tus":"review_required"}']:
            c = cases()[1]; c['evidence']['output'] = output
            self.assertEqual('fail', evaluate(sample(c))['rules'][0]['status'])

    def test_unicode_length_is_codepoints_and_evidence_is_not_normalized(self):
        c = cases()[1]
        c['rules'][0]['schema']['properties']['status'] = {'type': 'string', 'minLength': 1, 'maxLength': 1}
        for text, status in [('😀', 'pass'), ('e\u0301', 'fail')]:
            c['evidence']['output'] = json.dumps({'status': text}, ensure_ascii=False)
            self.assertEqual(status, evaluate(sample(c))['rules'][0]['status'])

    def test_schema_capabilities_and_case_bindings_are_strict(self):
        schema = cases()[1]['rules'][0]['schema']
        for change in [{'$ref': 'https://untrusted'}, {'additionalProperties': True}, {'required': ['other']},
                       {'required': ['status', 'status']}, {'properties': {'status': {'type': 'number'}}},
                       {'properties': {'status': {'type': 'string', 'pattern': '.*'}}},
                       {'properties': {'status': {'type': 'string', 'minLength': True}}}]:
            with self.assertRaises(ValueError): flat_schema({**schema, **change})
        original = sample(cases()[0]); changed = copy.deepcopy(original)
        changed['case']['evidence']['toolEvents'][0]['args']['orderId'] = 'changed'
        with self.assertRaises(ValueError): validate_sample(changed)
        invalid = cases()[0]; invalid['rules'][2]['argumentSchemas']['outside'] = schema
        with self.assertRaises(ValueError): definition_case(invalid)
        invalid = cases()[0]; invalid['evidence']['output'] = '한' * 171
        with self.assertRaises(ValueError): definition_case(invalid)

if __name__ == '__main__': unittest.main()
