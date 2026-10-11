"""Mocked scanner lifecycle fixtures; these are not vulnerability scan evidence."""
import contextlib,importlib.util,io,json,pathlib,runpy,shutil,subprocess,tempfile,unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parent.parent

class Lifecycle(unittest.TestCase):
    def fixture(self, script, failure=None):
        temporary=tempfile.TemporaryDirectory(dir=ROOT/'.local')
        self.addCleanup(temporary.cleanup)
        root=pathlib.Path(temporary.name);(root/'scripts').mkdir();(root/'.local').mkdir()
        for name in [script,'stack-scan-scratch.py']:
            shutil.copyfile(ROOT/'scripts'/name,root/'scripts'/name)
        def command(args,**kwargs):
            if args[:2]==['git','rev-parse']:return subprocess.CompletedProcess(args,0,'1'*40+'\n','')
            if args[:3]==['docker','image','inspect']:return subprocess.CompletedProcess(args,0,json.dumps([{'Id':'sha256:'+'a'*64,'Size':4096}]),'')
            if args[:3]==['docker','image','save']:
                archive=pathlib.Path(args[args.index('-o')+1]);archive.write_bytes(b'fixture archive')
                if failure=='export' and kwargs.get('check'):raise subprocess.CalledProcessError(1,args,stderr='fixture export failure')
                return subprocess.CompletedProcess(args,1 if failure=='export' else 0,'','fixture failure' if failure=='export' else '')
            if args[:2]==['docker','run']:
                output=next(arg for arg in args if arg.startswith('type=bind,source=') and arg.endswith(',target=/out'))
                output=pathlib.Path(output.removeprefix('type=bind,source=').removesuffix(',target=/out'))
                if 'syft' in args:
                    name=next(arg for arg in args if arg.startswith('cyclonedx-json=/out/')).split('/out/')[1]
                    (output/name).write_text(json.dumps({'bomFormat':'CycloneDX','components':[{'name':'fixture'}]}))
                    return subprocess.CompletedProcess(args,0,'','')
                if 'trivy' in args:
                    if failure=='scan':return subprocess.CompletedProcess(args,2,'','fixture scan failure')
                    name=args[args.index('--output')+1].split('/out/')[1]
                    findings=[{'Severity':'HIGH'}] if failure=='findings' else []
                    (output/name).write_text(json.dumps({'SchemaVersion':2,'Results':[{'Vulnerabilities':findings}]}))
                    return subprocess.CompletedProcess(args,1 if findings else 0,'','')
            raise AssertionError('Unexpected fixture subprocess')
        argv=[str(root/'scripts'/script)]
        if script=='stack-observability-security.py':argv+=['--name','grafana','--reference','agenttrust-grafana:local']
        with patch('subprocess.run',side_effect=command),patch('shutil.disk_usage',return_value=shutil._ntuple_diskusage(200*1073741824,0,200*1073741824)),patch('sys.argv',argv),contextlib.redirect_stdout(io.StringIO()):
            try:runpy.run_path(str(root/'scripts'/script),run_name='__main__')
            except SystemExit as exit_status:self.assertEqual(1 if failure else 0,exit_status.code)
        summary=next((root/'.local').glob('*/summary.json'));report=json.loads(summary.read_text())
        self.assertEqual(not failure,report['completed'])
        self.assertTrue(report['temporaryArchivesRemoved'])
        self.assertEqual([],list((root/'.local').rglob('*.tar')))
        self.assertTrue(list((summary.parent/'reports').glob('*.json')) or failure=='export')

    def test_full_delivery_success_preserves_reports_without_archives(self):self.fixture('stack-security-images.py')
    def test_full_delivery_findings_fail_and_still_remove_archives(self):self.fixture('stack-security-images.py','findings')
    def test_full_delivery_scan_failure_removes_current_archive(self):self.fixture('stack-security-images.py','scan')
    def test_full_delivery_partial_export_is_removed(self):self.fixture('stack-security-images.py','export')
    def test_observation_success_preserves_reports_without_archives(self):self.fixture('stack-observability-security.py')
    def test_observation_findings_fail_and_still_remove_archives(self):self.fixture('stack-observability-security.py','findings')
    def test_observation_partial_export_is_removed(self):self.fixture('stack-observability-security.py','export')

if __name__=='__main__':unittest.main()
