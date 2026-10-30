"""Bounded read-only main-run and public Docker Hub manifest checks."""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request

REPOSITORY = 'automaster5013/AgentTrust'
JOBS = {'security-source','integration','images','security-images','Publish verified stack to Docker Hub'}
MEDIA = ('application/vnd.oci.image.manifest.v1+json','application/vnd.oci.image.index.v1+json',
         'application/vnd.docker.distribution.manifest.v2+json','application/vnd.docker.distribution.manifest.list.v2+json')


def require(value):
    if not value: raise ValueError('Online release evidence refused')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected evidence redirect')


def get(url, headers=None, limit=1048576):
    parsed=urllib.parse.urlsplit(url)
    require(parsed.scheme=='https' and parsed.hostname in {'api.github.com','auth.docker.io','registry-1.docker.io'} and not parsed.username and not parsed.password)
    request=urllib.request.Request(url,headers=headers or {})
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
        require(response.status==200)
        raw=response.read(limit+1);require(0<len(raw)<=limit)
        return raw,dict(response.headers.items())


def validate_run(run,jobs,revision,run_id,attempt):
    require(type(run_id) is int and run_id>0 and type(attempt) is int and attempt>0)
    require(re.fullmatch('[a-f0-9]{40}',revision) is not None)
    require(run['id']==run_id and run['run_attempt']==attempt and run['head_sha']==revision)
    require(run['repository']['full_name']==REPOSITORY and run['head_repository']['full_name']==REPOSITORY)
    require(run['head_branch']=='main' and run['event'] in ('push','workflow_dispatch'))
    require(run['path']=='.github/workflows/original-stack.yml')
    require(run['status']=='completed' and run['conclusion']=='success')
    rows=jobs['jobs'];require(jobs['total_count']==len(rows)==len(JOBS))
    require({row['name'] for row in rows}==JOBS)
    for row in rows:
        require(row['run_id']==run_id and row['run_attempt']==attempt)
        require(row['status']=='completed' and row['conclusion']=='success')
    return {'trustedMainRunVerified':True,'runId':run_id,'runAttempt':attempt,'requiredJobsVerified':len(rows)}


def main_run(revision,run_id,attempt,fetch=get):
    require(type(run_id) is int and run_id>0 and type(attempt) is int and attempt>0)
    headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    token=os.environ.get('GITHUB_TOKEN')
    if token: headers['Authorization']='Bearer '+token
    base='https://api.github.com/repos/'+REPOSITORY+'/actions/runs/'+str(run_id)
    run=json.loads(fetch(base,headers)[0])
    jobs=json.loads(fetch(base+'/attempts/'+str(attempt)+'/jobs?per_page=100',headers)[0])
    return validate_run(run,jobs,revision,run_id,attempt)


def public_manifests(rows,fetch=get):
    require(isinstance(rows,list) and len(rows)==16 and len({r['name'] for r in rows})==16)
    for row in rows:
        require(re.fullmatch(r'[a-z]+(?:-[a-z]+)*',row['name']) is not None)
        prefix='docker.io/automaster5013/agenttrust-'+row['name']+'@'
        require(row['reference'].startswith(prefix))
        digest=row['reference'][len(prefix):];require(re.fullmatch('sha256:[a-f0-9]{64}',digest) is not None)
        repository='automaster5013/agenttrust-'+row['name']
        query=urllib.parse.urlencode({'service':'registry.docker.io','scope':'repository:'+repository+':pull'})
        response=json.loads(fetch('https://auth.docker.io/token?'+query,limit=65536)[0])
        token=response.get('token',response.get('access_token'));require(isinstance(token,str) and 0<len(token)<=32768)
        raw,headers=fetch('https://registry-1.docker.io/v2/'+repository+'/manifests/'+digest,
                          {'Authorization':'Bearer '+token,'Accept':', '.join(MEDIA)})
        normalized={k.lower():v for k,v in headers.items()}
        require(normalized.get('docker-content-digest')==digest)
        require('sha256:'+hashlib.sha256(raw).hexdigest()==digest)
        frame=json.loads(raw);require(frame.get('schemaVersion')==2 and frame.get('mediaType') in MEDIA)
    return {'destinationManifestDigestsVerified':True,'publicRegistryManifestsRead':len(rows),
            'imageLayersDownloaded':False,'registryImagesExecuted':False}
