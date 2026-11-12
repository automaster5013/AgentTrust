"""Check the disposable connector candidate graph without reading runtime settings."""
import pathlib,re,shlex,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class ConnectorCandidateTests(unittest.TestCase):
 def test_synthetic_candidate_builds_and_starts_its_authenticated_verifier(self):
  source=(ROOT/'.github/workflows/original-stack.yml').read_text(encoding='utf-8')
  block=source.split('name: Build and start the candidate with synthetic evaluation only',1)[1].split('      - uses:',1)[0]
  commands=[shlex.split(line.strip()) for line in block.splitlines() if line.strip().startswith('docker compose ')]
  for verb in ['build','up']:
   selected=[parts for parts in commands if verb in parts]
   self.assertEqual(len(selected),1)
   self.assertIn('stack-quality-verifier',selected[0], 'Connector synthetic jobs require the actual Ajv service')
   self.assertNotIn('stack-ollama',selected[0], 'Recorded observations must not start provider inference')
  dependency=block.split('depends_on: !override',1)[1].split('          YAML',1)[0]
  self.assertRegex(dependency,r'stack-quality-verifier:\s+condition: service_healthy')
  self.assertNotIn('stack-ollama:',dependency)
if __name__=='__main__':unittest.main()
