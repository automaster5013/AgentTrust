"""No-Docker controls for timeout observation and owned probe cleanup identity."""
import importlib.util
import pathlib
import subprocess
import types
import unittest
import uuid
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('coherent_rehearsal',pathlib.Path(__file__).with_name('stack-coherent-recovery.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.drill=object.__new__(module.Rehearsal)
        self.drill.id=str(uuid.uuid4());self.drill.prefix='agenttrust-stack-coldrestore-'+self.drill.id
        self.drill.directory=module.ROOT/'.local'/('orchestration-contract-'+self.drill.id)
        self.credential=self.drill.directory/'credentials';self.anchor=self.drill.directory/'anchor'
        self.drill.private=[self.credential,self.anchor];self.drill.containers=[];self.drill.report={};self.drill.save=Mock()
        self.drill.sources={'stack-core-api':{'Config':{'Healthcheck':{'Test':['CMD','health-probe']}}}}

    def test_transient_health_observation_timeout_rechecks_same_container_without_restart(self):
        with patch.object(module,'inspect',return_value={'State':{'Running':True}}),patch.object(module,'run',side_effect=[subprocess.TimeoutExpired(['docker','exec'],8),types.SimpleNamespace(returncode=0)]) as command,patch.object(module.time,'sleep'):
            name=self.drill.prefix+'-stack-core-api';self.drill.wait(name,'stack-core-api')
            self.assertEqual(self.drill.report['transientReadinessProbeTimeouts'],1)
            self.assertEqual(command.call_count,2)
            self.assertTrue(all(call.args[0][:3]==['docker','exec',name] for call in command.call_args_list))

    def test_unavailable_health_still_fails_at_original_total_deadline(self):
        with patch.object(module,'inspect',return_value={'State':{'Running':True}}),patch.object(module,'run',return_value=types.SimpleNamespace(returncode=1)) as command,patch.object(module.time,'sleep'),patch.object(module.time,'monotonic',side_effect=[0,0,181]):
            with self.assertRaises(TimeoutError):self.drill.wait(self.drill.prefix+'-stack-core-api','stack-core-api')
            self.assertEqual(command.call_count,1)

    def test_network_probe_is_named_labelled_portless_and_uses_only_owned_read_only_mounts(self):
        with patch.object(module,'run',return_value=types.SimpleNamespace(returncode=0)) as command:
            self.drill.application_probe('test','sha256:'+'a'*64,'stack-coherent-recovery-probe.py',str(self.credential),{self.anchor:'/probe-anchor.json'},180)
            args=command.call_args.args[0]
            self.assertIn('agenttrust.fixture='+self.drill.id,args);self.assertIn(self.drill.prefix,args)
            self.assertNotIn('-p',args);self.assertNotIn('--publish',args);self.assertNotIn('/var/run/docker.sock',' '.join(args))
            mounts=[args[i+1] for i,value in enumerate(args) if value=='--mount']
            self.assertTrue(all(value.endswith(',readonly') for value in mounts))
            self.assertEqual(self.drill.containers,[self.drill.prefix+'-probe-test'])

    def test_probe_identity_is_tracked_before_a_timeout_so_cleanup_can_find_it(self):
        with patch.object(module,'run',side_effect=subprocess.TimeoutExpired(['docker','run'],180)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.drill.application_probe('timed-out','sha256:'+'a'*64,'stack-coherent-recovery-probe.py',str(self.credential),{self.anchor:'/probe-anchor.json'},180)
            self.assertEqual(self.drill.containers,[self.drill.prefix+'-probe-timed-out'])

    def test_foreign_mount_unowned_file_script_or_destination_refused_before_docker(self):
        cases=[('test','unknown.py',self.credential,{self.anchor:'/probe-anchor.json'}),
               ('bad;name','stack-coherent-recovery-probe.py',self.credential,{self.anchor:'/probe-anchor.json'}),
               ('test','stack-coherent-recovery-probe.py',self.drill.directory/'unowned',{self.anchor:'/probe-anchor.json'}),
               ('test','stack-coherent-recovery-probe.py',self.credential,{self.anchor:'/run/secrets/arbitrary'})]
        with patch.object(module,'run') as command:
            for kind,script,credential,mounts in cases:
                with self.subTest(kind=kind,script=script),self.assertRaises(ValueError):
                    self.drill.application_probe(kind,'sha256:'+'a'*64,script,str(credential),mounts,180)
            command.assert_not_called()


if __name__=='__main__':unittest.main()
