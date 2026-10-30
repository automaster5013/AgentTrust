"""Authenticated bounded file chunks; no plaintext host backup and no atomicity claim."""
import hashlib,json,pathlib,re
CHUNK=16*1024*1024;LIMIT=1024*1024*1024

def require(value):
 if not value:raise ValueError('Chunked cache contract refused')

def validate(manifest):
 require(manifest['schemaVersion']==1 and manifest['kind']=='bounded-file-cache' and manifest['crossStoreSnapshotAtomic'] is False)
 total=0;indexes=[];require(0<len(manifest['files'])<=20000)
 for name,row in manifest['files'].items():
  path=pathlib.PurePosixPath(name);require(name and path.parts and len(name)<=1024 and str(path)==name and not path.is_absolute() and '..' not in path.parts and re.fullmatch('[A-Za-z0-9._/-]+',name))
  require(type(row['bytes']) is int and 0<=row['bytes']<=LIMIT and type(row['mode']) is int and 0<=row['mode']<=0o777 and re.fullmatch('[a-f0-9]{64}',row['sha256']))
  offset=0
  for chunk in row['chunks']:
   require(type(chunk['offset']) is int and chunk['offset']==offset and type(chunk['bytes']) is int and 0<chunk['bytes']<=CHUNK)
   require(type(chunk['cipherBytes']) is int and 0<chunk['cipherBytes']<=CHUNK+128)
   require(chunk['file']=='chunk-'+str(len(indexes)).zfill(6)+'.aesgcm' and re.fullmatch('[a-f0-9]{64}',chunk['cipherSha256']) and re.fullmatch('[a-f0-9]{64}',chunk['plainSha256']))
   indexes.append(chunk['file']);offset+=chunk['bytes']
  require(offset==row['bytes']);total+=offset;require(total<=LIMIT)
 return total

def capture(files,read,encrypt,write):
 manifest={'schemaVersion':1,'kind':'bounded-file-cache','crossStoreSnapshotAtomic':False,'files':{}};index=0
 for name,source in sorted(files.items()):
  row=dict(source);row['chunks']=[];digest=hashlib.sha256();offset=0
  while offset<source['bytes']:
   size=min(CHUNK,source['bytes']-offset);raw=read(name,offset,size);require(len(raw)==size);digest.update(raw)
   cipher=encrypt(raw);filename='chunk-'+str(index).zfill(6)+'.aesgcm';write(filename,cipher)
   row['chunks'].append({'file':filename,'offset':offset,'bytes':size,'plainSha256':hashlib.sha256(raw).hexdigest(),'cipherSha256':hashlib.sha256(cipher).hexdigest(),'cipherBytes':len(cipher)})
   index+=1;offset+=size
  require(digest.hexdigest()==source['sha256']);manifest['files'][name]=row
 validate(manifest);return manifest

def restore(manifest,read,decrypt,write,finalize):
 validate(manifest)
 # Authenticate every declared chunk before the first target write.
 for row in manifest['files'].values():
  for chunk in row['chunks']:
   cipher=read(chunk['file']);require(len(cipher)==chunk['cipherBytes'] and hashlib.sha256(cipher).hexdigest()==chunk['cipherSha256'])
   raw=decrypt(cipher);require(len(raw)==chunk['bytes'] and hashlib.sha256(raw).hexdigest()==chunk['plainSha256'])
 for name,row in manifest['files'].items():
  digest=hashlib.sha256()
  if not row['chunks']:write(name,0,b'')
  for chunk in row['chunks']:
   cipher=read(chunk['file']);require(len(cipher)==chunk['cipherBytes'] and hashlib.sha256(cipher).hexdigest()==chunk['cipherSha256'])
   raw=decrypt(cipher);require(len(raw)==chunk['bytes'] and hashlib.sha256(raw).hexdigest()==chunk['plainSha256']);digest.update(raw);write(name,chunk['offset'],raw)
  require(digest.hexdigest()==row['sha256']);finalize(name,row['bytes'],row['mode'])
