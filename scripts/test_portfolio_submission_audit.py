import importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('portfolio_audit',ROOT/'scripts/portfolio-submission-audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
class AuditControls(unittest.TestCase):
 def setUp(self):
  (ROOT/'.local').mkdir(exist_ok=True)
  self.temp=tempfile.TemporaryDirectory(prefix='portfolio-audit-control-',dir=ROOT/'.local')
  self.root=Path(self.temp.name).resolve();assert self.root.is_relative_to(ROOT/'.local')
  self.addCleanup(self.temp.cleanup)
 def write(self,name,text):
  p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8');return p
 def run_audit(self,text):self.write('review.md',text);return audit.audit(self.root,['review.md'])
 def test_good_links_and_duplicate_heading_anchors(self):
  self.write('guide.md','# Start\n\n## Repeat\n\n## Repeat\n'.replace('\\n','\n'))
  self.assertTrue(self.run_audit('[guide](guide.md#repeat-1)')['passed'])
 def test_missing_target_is_a_failure(self):
  self.assertEqual(self.run_audit('[missing](missing.md)')['findings'][0]['kind'],'missing-link-target')
 def test_private_and_escaped_paths_are_refused(self):
  self.write('.local/hidden.md','# private')
  self.assertEqual(self.run_audit('[private](%2elocal/hidden.md)')['findings'][0]['kind'],'private-path-link')
  self.assertEqual(self.run_audit('[outside](../outside.md)')['findings'][0]['kind'],'link-outside-root')
 def test_secret_values_are_never_reported(self):
  value='sk-'+'A'*48;result=self.run_audit(value)
  self.assertFalse(result['passed']);self.assertNotIn(value,json.dumps(result))
 def test_sensitive_query_is_not_echoed(self):
  value='synthetic-value-never-echo';result=self.run_audit('[site](https://example.invalid/?access_token='+value+')')
  self.assertEqual(result['findings'][0]['kind'],'sensitive-url-query');self.assertNotIn(value,json.dumps(result))
 def test_fenced_examples_are_not_live_links(self):
  self.assertTrue(self.run_audit('```text\n[example](missing.md)\n```\n'.replace('\\n','\n'))['passed'])
 def test_audit_does_not_modify_files(self):
  self.write('guide.md','# Existing');self.write('review.md','[guide](guide.md)');before={str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()};audit.audit(self.root,['review.md']);after={str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()};self.assertEqual(before,after)
 def test_network_paths_are_refused_before_resolution(self):
  remote=chr(92)*2+'example.invalid'+chr(92)+'share'+chr(92)+'file.md';self.assertEqual(self.run_audit('[remote]('+remote+')')['findings'][0]['kind'],'absolute-link-path')
 def test_private_document_is_not_scanned(self):
  self.write('.local/hidden.md','sk-'+'A'*48);result=audit.audit(self.root,['.local/hidden.md']);self.assertEqual(result['documentsChecked'],0);self.assertEqual(result['findings'][0]['kind'],'private-document-path')
 def test_large_anchor_target_is_not_read(self):
  self.write('large.md','# '+'x'*1048576);self.assertEqual(self.run_audit('[large](large.md#x)')['findings'][0]['kind'],'link-target-too-large')
 def test_missing_anchor_is_a_failure(self):
  self.write('guide.md','# Existing');self.assertEqual(self.run_audit('[guide](guide.md#absent)')['findings'][0]['kind'],'missing-heading-anchor')
if __name__=='__main__':unittest.main()
