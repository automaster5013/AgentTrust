"""Networkless container helper; /data is either a read-only source or owned target."""
import argparse,datetime,hashlib,json,os,pathlib,re,sqlite3,stat,sys
ROOT=pathlib.Path('/data');CHUNK=16*1024*1024;LIMIT=1024*1024*1024

def require(value):
 if not value:raise ValueError('Bounded volume file refused')

def file_digest(path):
 value=hashlib.sha256()
 with path.open('rb') as stream:
  while raw:=stream.read(1048576):value.update(raw)
 return value.digest()

def path_for(value,read_alias=False):
 path=pathlib.PurePosixPath(value)
 require(value and path.parts and len(value)<=1024 and not path.is_absolute() and '..' not in path.parts and str(path)==value and re.fullmatch('[A-Za-z0-9._/-]+',value))
 target=ROOT.joinpath(*path.parts)
 for item in (target,*target.parents):
  if item==ROOT.parent:break
  require(not item.is_symlink() or (read_alias and item.resolve().is_relative_to(ROOT.resolve())))
 require(target.resolve().is_relative_to(ROOT.resolve()));return target

def inventory(prefix=None):
 files={};total=0
 start=ROOT if prefix is None else path_for(prefix,True);require(start.is_dir())
 for directory,children,names in os.walk(start,followlinks=False):
  require(all(not pathlib.Path(directory,name).is_symlink() for name in children))
  for name in sorted(names):
   relative=pathlib.Path(directory,name).relative_to(ROOT).as_posix();path=path_for(relative,True)
   with path.open('rb') as stream:
    before=os.fstat(stream.fileno());require(stat.S_ISREG(before.st_mode) and before.st_nlink>=1 and not before.st_mode&0o7000 and before.st_size<=LIMIT)
    total+=before.st_size;require(total<=LIMIT and len(files)<20000);digest=hashlib.sha256()
    while chunk:=stream.read(1048576):digest.update(chunk)
    after=os.fstat(stream.fileno());require((before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns))
   files[relative]={'bytes':before.st_size,'sha256':digest.hexdigest(),'mode':stat.S_IMODE(before.st_mode)}
 require(files);return files

def select_blocks():
 base=ROOT/'blocks';require(base.is_dir() and not base.is_symlink());candidates=[]
 tenants=list(base.iterdir());require(len(tenants)<=100)
 for tenant in tenants:
  if not tenant.is_dir() or tenant.is_symlink():continue
  for path in tenant.iterdir():
   if path.is_dir() and not path.is_symlink():candidates.append(path)
   require(len(candidates)<=100000)
 now=datetime.datetime.now(datetime.timezone.utc);selected=[]
 for path in sorted(candidates,key=lambda p:p.stat().st_mtime_ns,reverse=True):
  meta=path/'meta.json'
  if not meta.is_file() or meta.is_symlink():continue
  require(meta.stat().st_size<=1048576);row=json.loads(meta.read_bytes())
  end=datetime.datetime.fromisoformat(row['endTime'].replace('Z','+00:00'));start=datetime.datetime.fromisoformat(row['startTime'].replace('Z','+00:00'))
  if end.tzinfo is None or start.tzinfo is None or (now-end).total_seconds()<120 or row.get('totalObjects',0)<=0:continue
  require(str(row['blockID'])==path.name)
  selected.append({'prefix':path.relative_to(ROOT).as_posix(),'start':int(start.timestamp()),'end':int(end.timestamp()),'objects':row['totalObjects']})
  if len(selected)==3:break
 require(selected);return selected

def catalog():
 files={};total=0
 for directory,children,names in os.walk(ROOT,followlinks=False):
  require(all(not pathlib.Path(directory,name).is_symlink() for name in children))
  for name in names:
   relative=pathlib.Path(directory,name).relative_to(ROOT).as_posix();path=pathlib.Path(directory,name);info=path.lstat()
   if not stat.S_ISREG(info.st_mode):raise ValueError('Nonregular catalog member')
   if info.st_nlink<1:raise ValueError('Unlinked catalog member')
   if len(files)>=50000:raise ValueError('Catalog member count exceeds bound')
   total+=info.st_size;require(total<=16*1024*1024*1024)
   files[relative]={'bytes':info.st_size,'mode':stat.S_IMODE(info.st_mode),'mtimeNs':info.st_mtime_ns,'links':info.st_nlink}
 return files

def summary():
 groups={};count=0;other=0;changed=0
 for directory,children,names in os.walk(ROOT,followlinks=False):
  require(all(not pathlib.Path(directory,name).is_symlink() for name in children))
  for name in names:
   count+=1;require(count<=500000);path=pathlib.Path(directory,name)
   try:info=path.lstat()
   except FileNotFoundError:changed+=1;continue
   if not stat.S_ISREG(info.st_mode):other+=1;continue
   first=path.relative_to(ROOT).parts[0];group=first if first in ('wal','blocks','chunks_head','chunks','index','compactor','data','plugins') else 'other'
   row=groups.setdefault(group,{'files':0,'logicalBytes':0,'hardlinkedFiles':0});row['files']+=1;row['logicalBytes']+=info.st_size;row['hardlinkedFiles']+=int(info.st_nlink>1)
 return {'groups':groups,'entries':count,'nonRegularEntries':other,'disappearedEntries':changed}

def internal_links():
 links={}
 for directory,children,names in os.walk(ROOT,followlinks=False):
  require(all(not pathlib.Path(directory,name).is_symlink() for name in children))
  for name in names:
   path=pathlib.Path(directory,name)
   if path.is_symlink():
    relative=path.relative_to(ROOT).as_posix();resolved=path_for(relative,True).resolve();require(resolved.is_file())
    links[relative]=resolved.relative_to(ROOT.resolve()).as_posix();require(len(links)<=1000)
 return links

def sqlite_snapshot():
 path=path_for('grafana.db');require(path.stat().st_size<=32*1024*1024)
 source=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=2);source.execute('PRAGMA query_only=ON');target=sqlite3.connect(':memory:')
 try:
  source.backup(target,pages=256,sleep=0.01);require(target.execute('PRAGMA integrity_check').fetchone()[0]=='ok');raw=target.serialize();require(0<len(raw)<=32*1024*1024);return raw
 finally:target.close();source.close()

def sqlite_verify(raw):
 require(raw.startswith(b'SQLite format 3\x00') and len(raw)<=32*1024*1024);database=sqlite3.connect(':memory:')
 try:
  database.deserialize(raw);require(database.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
  columns={row[1] for row in database.execute('PRAGMA table_info(dashboard)')}
  dashboards=[{'uid':row[0],'title':row[1]} for row in database.execute('SELECT uid,title FROM dashboard'+(' WHERE is_folder=0' if 'is_folder' in columns else '')+' ORDER BY uid')]
  sources=[{'uid':row[0],'type':row[1],'url':row[2]} for row in database.execute('SELECT uid,type,url FROM data_source ORDER BY uid')]
  require(0<=len(dashboards)<=1000 and 0<=len(sources)<=1000)
  return {'completed':True,'integrityVerified':True,'databaseSha256':hashlib.sha256(raw).hexdigest(),'dashboards':dashboards,'dataSources':sources}
 finally:database.close()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('action',choices=('inventory','select-blocks','catalog','summary','links','link','sqlite-snapshot','sqlite-verify','read','write','finalize'));parser.add_argument('--path');parser.add_argument('--prefix');parser.add_argument('--target');parser.add_argument('--offset',type=int,default=0);parser.add_argument('--size',type=int,default=0);parser.add_argument('--mode',type=int,default=384);args=parser.parse_args()
 if args.action=='inventory':print(json.dumps(inventory(args.prefix),sort_keys=True));return
 if args.action=='select-blocks':print(json.dumps(select_blocks()));return
 if args.action=='catalog':print(json.dumps(catalog(),sort_keys=True));return
 if args.action=='summary':print(json.dumps(summary(),sort_keys=True));return
 if args.action=='links':print(json.dumps(internal_links(),sort_keys=True));return
 if args.action=='sqlite-snapshot':sys.stdout.buffer.write(sqlite_snapshot());return
 if args.action=='sqlite-verify':print(json.dumps(sqlite_verify(sys.stdin.buffer.read(32*1024*1024+1))));return
 path=path_for(args.path,args.action=='read');require(0<=args.offset<=LIMIT and 0<=args.size<=CHUNK)
 if args.action=='read':
  descriptor=os.open(path.resolve(),os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(descriptor,'rb') as stream:
   before=os.fstat(stream.fileno());require(stat.S_ISREG(before.st_mode) and before.st_nlink>=1 and args.offset+args.size<=before.st_size)
   stream.seek(args.offset);raw=stream.read(args.size);after=os.fstat(stream.fileno())
   require(len(raw)==args.size and (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns));sys.stdout.buffer.write(raw)
 elif args.action=='write':
  raw=sys.stdin.buffer.read(CHUNK+1);require(len(raw)==args.size)
  path.parent.mkdir(parents=True,exist_ok=True);descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
  with os.fdopen(descriptor,'ab') as stream:
   info=os.fstat(stream.fileno());require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size==args.offset and args.offset+len(raw)<=LIMIT);stream.write(raw)
 elif args.action=='finalize':
  require(0<=args.mode<=0o777 and path.is_file() and path.stat().st_size==args.offset);path.chmod(args.mode)
 else:
  target=path_for(args.target);require(path!=target and target.is_file() and not target.is_symlink() and path.is_file() and not path.is_symlink())
  require(file_digest(path)==file_digest(target))
  path.unlink();path.symlink_to(os.path.relpath(target,path.parent))

if __name__=='__main__':main()
