"""Chunk order/authentication, target scope and real filesystem path boundaries."""
import copy,hashlib,importlib.util,os,pathlib,tempfile,types,unittest
from unittest.mock import Mock,patch
import stack_chunked_cache as chunks
ROOT=pathlib.Path(__file__).resolve().parent.parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
crypto=module('cache_crypto','stack-backup-crypt.py');helper=module('cache_files','stack-file-volume-helper.py');model=module('cache_model','stack-model-cache-recovery.py')

class CacheChunks(unittest.TestCase):
 def fixture(self):
  body=b'bounded-fixture-'*500;files={'blobs/fixture':{'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'mode':0o644}};stored={};key=b'k'*32
  with patch.object(chunks,'CHUNK',1024):manifest=chunks.capture(files,lambda name,offset,size:body[offset:offset+size],lambda raw:crypto.transform('encrypt',key,raw),lambda name,raw:stored.__setitem__(name,raw))
  return body,manifest,stored,key
 def test_multi_chunk_roundtrip_and_file_hash(self):
  body,manifest,stored,key=self.fixture();output=bytearray();final=[]
  with patch.object(chunks,'CHUNK',1024):chunks.restore(manifest,stored.__getitem__,lambda raw:crypto.transform('decrypt',key,raw),lambda name,offset,raw:(self.assertEqual(len(output),offset),output.extend(raw)),lambda *args:final.append(args))
  self.assertEqual(bytes(output),body);self.assertGreater(len(stored),1);self.assertEqual(final,[('blobs/fixture',len(body),0o644)])
 def test_tampered_cipher_or_wrong_key_cannot_reach_first_write(self):
  from cryptography.exceptions import InvalidTag
  for wrong in (False,True):
   body,manifest,stored,key=self.fixture();writer=Mock()
   if not wrong:stored[next(iter(stored))]=b'tampered'
   with patch.object(chunks,'CHUNK',1024),self.assertRaises((ValueError,InvalidTag)):
    chunks.restore(manifest,stored.__getitem__,lambda raw:crypto.transform('decrypt',b'x'*32 if wrong else key,raw),writer,Mock())
   writer.assert_not_called()
 def test_missing_reordered_duplicate_and_traversing_chunks_refused(self):
  body,manifest,stored,key=self.fixture()
  for action in ('missing','reorder','duplicate','path'):
   changed=copy.deepcopy(manifest);row=changed['files']['blobs/fixture']
   if action=='missing':row['chunks'].pop()
   elif action=='reorder':row['chunks'].reverse()
   elif action=='duplicate':row['chunks'][1]['file']=row['chunks'][0]['file']
   else:changed['files']['../escape']=changed['files'].pop('blobs/fixture')
   with patch.object(chunks,'CHUNK',1024),self.assertRaises(ValueError):chunks.validate(changed)
 def test_source_change_during_capture_refused(self):
  files={'fixture':{'bytes':4,'sha256':hashlib.sha256(b'good').hexdigest(),'mode':0o600}}
  with self.assertRaises(ValueError):chunks.capture(files,lambda *args:b'evil',lambda raw:raw,lambda *args:None)
 def test_file_helper_refuses_absolute_parent_and_noncanonical_paths(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   self.assertEqual(helper.path_for('blobs/fixture'),pathlib.Path(temporary)/'blobs/fixture')
   for path in ('../escape','/absolute','.','blobs//file','blobs/../file'):
    with self.assertRaises(ValueError):helper.path_for(path)
 def test_source_volume_can_never_be_a_write_target(self):
  drill=types.SimpleNamespace(source_volume='source',target_volume='owned',tools='tool',file_user='10001:10001',sources={'stack-ollama':{'Config':{'User':'10001:10001'}}},own_volume=Mock())
  with self.assertRaises(ValueError):model.file_command(drill,'source','write','file',0,3)
  read=model.file_command(drill,'source','read','file',0,3);self.assertIn('type=volume,source=source,target=/data,readonly',read)
  write=model.file_command(drill,'owned','write','file',0,3);self.assertIn('type=volume,source=owned,target=/data',write);drill.own_volume.assert_called_once_with('owned')
 @unittest.skipIf(os.name=='nt','POSIX symlink behavior is exercised in the pinned Linux image')
 def test_only_internal_read_aliases_are_allowed(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary:
   base=pathlib.Path(temporary);root=base/'data';root.mkdir();(root/'target').write_bytes(b'fixture');(base/'outside').write_bytes(b'outside')
   (root/'inside').symlink_to(root/'target');(root/'escape').symlink_to(base/'outside')
   with patch.object(helper,'ROOT',root):
    self.assertEqual(helper.path_for('inside',True).resolve(),root/'target')
    with self.assertRaises(ValueError):helper.path_for('inside')
    with self.assertRaises(ValueError):helper.path_for('escape',True)

if __name__=='__main__':unittest.main()
