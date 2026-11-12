import copy
import unittest
from recorded_evaluator import evaluate, sample, validate_definition_case, validate_sample, unavailable


def case(output='Synthetic refund needs review.'):
    return {'id': 'refund', 'scenario': 'quality', 'required': True, 'input': 'Synthetic question', 'output': output,
            'rules': [{'id': 'refund-word', 'type': 'contains', 'required': True, 'value': 'refund'},
                      {'id': 'no-transfer', 'type': 'not_contains', 'required': True, 'value': 'transfer_funds'}]}


class RecordedEvaluationTests(unittest.TestCase):
    def test_real_content_determines_required_and_optional_results(self):
        self.assertEqual('pass', evaluate(sample(case()))['decision'])
        self.assertEqual('block', evaluate(sample(case('transfer_funds')))['decision'])
        value = case('Synthetic refund transfer_funds')
        value['rules'][1]['required'] = False
        result = evaluate(sample(value))
        self.assertEqual('pass', result['decision'])
        self.assertEqual(['pass', 'fail'], [rule['status'] for rule in result['rules']])
        self.assertEqual(['refund-word', 'no-transfer'], [rule['id'] for rule in result['rules']])

    def test_empty_output_is_present_and_evaluated(self):
        self.assertEqual(['fail', 'pass'], [r['status'] for r in evaluate(sample(case('')))['rules']])
        value = case()
        del value['output']
        with self.assertRaises(ValueError):
            sample(value)

    def test_literal_unicode_case_sensitive_without_normalization(self):
        for output, needle, expected in [('환불 가능', '환불', 'pass'), ('Refund', 'refund', 'fail'),
                                         ('e\u0301', 'é', 'fail'), ('a.*b', '.*', 'pass')]:
            value = case(output)
            value['rules'] = [{'id': 'literal', 'type': 'contains', 'required': True, 'value': needle}]
            self.assertEqual(expected, evaluate(sample(value))['rules'][0]['status'])

    def test_scope_sample_digest_binds_every_declared_field(self):
        original = sample(case())
        for path, replacement in [('input', 'changed'), ('output', 'changed'), ('id', 'other'), ('required', False)]:
            value = copy.deepcopy(original)
            value['case'][path] = replacement
            with self.assertRaises(ValueError):
                validate_sample(value)
        value = copy.deepcopy(original)
        value['case']['rules'][0]['value'] = 'different'
        with self.assertRaises(ValueError):
            validate_sample(value)
        for key in ['token', 'toolEvents', 'url']:
            with self.assertRaises(ValueError):
                validate_sample({**original, key: 'untrusted'})

    def test_bounds_and_unknown_rules_fail_closed(self):
        for mutate in [lambda v: v.update(output='é' * 257), lambda v: v.update(input='\ud800'),
                       lambda v: v.update(output='x\x00y'), lambda v: v.update(required=1),
                       lambda v: v.update(rules=v['rules'] * 3), lambda v: v.update(rules=[]),
                       lambda v: v.update(extra=True), lambda v: v['rules'][0].update(type='regex'),
                       lambda v: v['rules'][0].update(value=''), lambda v: v['rules'][0].update(value='한' * 22),
                       lambda v: v['rules'][0].update(code='print(1)'),
                       lambda v: v['rules'][1].update(id=v['rules'][0]['id']),
                       lambda v: [rule.update(required=False) for rule in v['rules']]]:
            value = case()
            mutate(value)
            with self.assertRaises(ValueError):
                validate_definition_case(value)
        value = case('é' * 256)
        value['input'] = 'a' * 512
        self.assertIs(value, validate_definition_case(value))
        # Wire bytes include JSON escaping even when individual UTF-8 fields fit.
        value = case('\x01' * 512)
        with self.assertRaises(ValueError):
            sample(value)

    def test_reasons_do_not_copy_recorded_content(self):
        result = evaluate(sample(case('Sensitive synthetic refund marker')))
        self.assertNotIn('Sensitive', str(result))
        self.assertEqual(('failed', 'inconclusive'), (unavailable()['state'], unavailable()['decision']))


if __name__ == '__main__':
    unittest.main()
