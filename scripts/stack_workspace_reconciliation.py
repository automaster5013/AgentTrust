"""Read-only reconciliation: an uncertain create is never adopted or replayed."""
import json,re,urllib.parse
from stack_workspace_onboarding import canonical_uuid,manifest_digest,parse_manifest,require,effective_realm_management_roles

STAGES=frozenset(('prepared','creating-disabled-user','verifying-disabled-cohort','activating-verified-cohort','completed','operator-reconciliation-required'))

def journal_for_review(raw,manifest):
    manifest=parse_manifest(json.dumps(manifest).encode())
    require(isinstance(raw,bytes) and 0<len(raw)<=32768)
    def pairs(rows):
        value={}
        for key,item in rows:
            require(key not in value);value[key]=item
        return value
    try:body=json.loads(raw.decode('utf-8'),object_pairs_hook=pairs)
    except (UnicodeError,json.JSONDecodeError,RecursionError):require(False)
    require(isinstance(body,dict) and set(body)=={'schemaVersion','completed','manifestSha256','organizationId','projectId','stage','members','createResponseUncertain','allKnownUsersDisabledAfterFailure'})
    require(type(body['schemaVersion']) is int and body['schemaVersion']==1 and type(body['completed']) is bool and type(body['createResponseUncertain']) is bool)
    require(isinstance(body['stage'],str) and body['stage'] in STAGES and body['completed']==(body['stage']=='completed'))
    require(body['allKnownUsersDisabledAfterFailure'] is None or type(body['allKnownUsersDisabledAfterFailure']) is bool)
    require(body['manifestSha256']==manifest_digest(manifest) and body['organizationId']==manifest['organizationId'] and body['projectId']==manifest['projectId'],'WORKSPACE_JOURNAL_MANIFEST_MISMATCH')
    rows=body['members'];require(isinstance(rows,list) and len(rows)<=len(manifest['members']))
    if body['completed']:require(len(rows)==len(manifest['members']) and not body['createResponseUncertain'])
    members=[];actors=set()
    for index,row in enumerate(rows):
        require(isinstance(row,dict) and set(row)=={'username','role','password','actorId'})
        require({'username':row['username'],'role':row['role']}==manifest['members'][index])
        require(isinstance(row['password'],str) and re.fullmatch('[a-f0-9]{48}',row['password']))
        identifier=row['actorId']
        if identifier is not None:
            canonical_uuid(identifier);require(identifier not in actors);actors.add(identifier)
        else:require(index==len(rows)-1 and body['createResponseUncertain'] and not body['completed'])
        members.append({'username':row['username'],'role':row['role'],'actorId':identifier})
    if body['createResponseUncertain']:require(bool(rows) and rows[-1]['actorId'] is None)
    return {'manifestSha256':body['manifestSha256'],'organizationId':body['organizationId'],'projectId':body['projectId'],'stage':body['stage'],'members':members,'unattemptedMembers':len(manifest['members'])-len(rows),'originalProvisioningCompleted':body['completed'],'createResponseUncertain':body['createResponseUncertain']}

def inspect_journal(api,cohort):
    result={'completed':False,'operation':'read-only-reconciliation','originalProvisioningCompleted':cohort['originalProvisioningCompleted'],'unattemptedMembers':cohort['unattemptedMembers'],'knownActorsChecked':0,'knownActorsEnabled':0,'knownActorsDisabled':0,'knownActorsWithChangedScopeOrRole':0,'unknownCreateCandidatesFound':0,'unknownCreatesNotFoundByExactName':0,'providerSessionsObserved':0,'providerWritesPerformed':False,'unknownActorsAdopted':False,'unknownRequestsReplayed':False,'applicationSessionRevocationVerified':False,'providerObservationIsAtomic':False,'manualReconciliationRequired':not cohort['originalProvisioningCompleted'] or cohort['createResponseUncertain']}
    for member in cohort['members']:
        identifier=member['actorId'];known=identifier is not None
        if not known:
            query=urllib.parse.urlencode({'username':member['username'],'exact':'true','max':'2'})
            candidates=api.read('/users?'+query)
            require(isinstance(candidates,list) and len(candidates)<=1,'WORKSPACE_RECONCILIATION_SEARCH_AMBIGUOUS')
            if not candidates:
                result['unknownCreatesNotFoundByExactName']+=1;continue
            require(isinstance(candidates[0],dict) and candidates[0].get('username')==member['username'])
            identifier=canonical_uuid(candidates[0].get('id'));result['unknownCreateCandidatesFound']+=1
        user=api.read('/users/'+identifier)
        require(isinstance(user,dict) and user.get('id')==identifier and type(user.get('enabled')) is bool)
        sessions=api.read('/users/'+identifier+'/sessions');require(isinstance(sessions,list) and len(sessions)<=100)
        result['providerSessionsObserved']+=len(sessions)
        if known:
            roles=api.read('/users/'+identifier+'/role-mappings/realm/composite');require(isinstance(roles,list) and len(roles)<=100)
            mappings=api.read('/users/'+identifier+'/role-mappings');require(isinstance(mappings,dict))
            recognized=[row.get('name') for row in roles if isinstance(row,dict) and row.get('name') in {'admin','editor','viewer'}]
            management=effective_realm_management_roles(api,identifier)
            matches=user.get('username')==member['username'] and user.get('attributes',{}).get('agenttrust_organization')==[cohort['organizationId']] and user.get('attributes',{}).get('agenttrust_project')==[cohort['projectId']] and recognized==[member['role']] and not mappings.get('clientMappings') and not management
            result['knownActorsChecked']+=1;result['knownActorsEnabled' if user['enabled'] else 'knownActorsDisabled']+=1
            if not matches:result['knownActorsWithChangedScopeOrRole']+=1;result['manualReconciliationRequired']=True
            if not cohort['originalProvisioningCompleted'] and (user['enabled'] or sessions):result['manualReconciliationRequired']=True
    result['completed']=True
    return result
