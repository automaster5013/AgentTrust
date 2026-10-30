"""Read-only comparison of live per-service Compose histories; no apply commands."""
import argparse
import importlib.util
import json
import pathlib
import re
import sys

ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('local_planner',ROOT/'scripts/stack-local-cd-plan.py')
planner=importlib.util.module_from_spec(spec);spec.loader.exec_module(planner)


def require(value):
    if not value:raise ValueError('Runtime reconciliation refused')


def compare_models(models,groups):
    require(len(models)==len(groups)>0)
    selected={};differences=[];baseline=models[0]['services']
    for index,(model,group) in enumerate(zip(models,groups),1):
        services=model['services'];require(set(planner.COMPONENTS)<=set(services))
        for service in planner.COMPONENTS:
            left={k:v for k,v in baseline[service].items() if k!='image'}
            right={k:v for k,v in services[service].items() if k!='image'}
            if left!=right:
                differences.append({'group':index,'service':service,
                                    'changedFields':sorted(k for k in set(left)|set(right) if (k in left)!=(k in right) or left.get(k)!=right.get(k))})
        for service in group['services']:
            require(service in planner.COMPONENTS and service not in selected)
            image=services[service]['image'];require(isinstance(image,str) and re.fullmatch('[a-z0-9][a-z0-9./:_@-]{0,255}',image))
            selected[service]={'group':index,'image':image,'declaredRestart':services[service].get('restart','no')}
    require(set(selected)==set(planner.COMPONENTS))
    return selected,differences


def project_resource_differences(models):
    require(isinstance(models,list) and models)
    base={k:v for k,v in models[0].items() if k!='services'}
    result=[]
    for i,model in enumerate(models,1):
        current={k:v for k,v in model.items() if k!='services'}
        fields=sorted(k for k in set(base)|set(current) if (k in base)!=(k in current) or base.get(k)!=current.get(k))
        if fields:result.append({'group':i,'changedFields':fields})
    return result


def analyze():
    require(pathlib.Path.cwd().resolve()==ROOT)
    ids=planner.running_ids();raw_inventory=json.loads(planner.docker(['inspect',*ids]));inventory=planner.summarize(raw_inventory)
    created_references={row['Config']['Labels']['com.docker.compose.service']:row['Config']['Image'] for row in raw_inventory}
    hashes=planner.compose_hashes(inventory,ROOT);groups=planner.runtime_file_groups(inventory)
    models=[]
    for group in groups:
        args=['compose','--project-name','agenttrust']
        for file in group['filesInOrder']:args+=['-f',file]
        raw=planner.docker(args+['config','--no-interpolate','--no-env-resolution','--format','json'])
        require(0<len(raw.encode())<=4194304)
        models.append(json.loads(raw))
    selected,differences=compare_models(models,groups)
    resource_differences=project_resource_differences(models)
    cache={};image_matches={};image_drift={};restart_overrides=[]
    for service,row in selected.items():
        image=row['image']
        if image not in cache:
            cache[image]=planner.docker(['image','inspect',image,'--format','{{.Id}}']).strip()
            require(re.fullmatch('sha256:[a-f0-9]{64}',cache[image]))
        image_matches[service]=cache[image]==inventory[service]['rollbackImageId']
        if not image_matches[service]:
            image_drift[service]='cached-reference-moved' if created_references[service]==image else 'declared-image-differs-from-created-reference'
        if row['declaredRestart']!=inventory[service]['restartPolicy']:restart_overrides.append(service)
    planner.recheck(ids,inventory,ROOT,hashes)
    return {'completed':True,'readOnly':True,'runtimeConfigurationGroups':len(groups),
            'groups':[{'group':i,'services':g['services'],'composeFileCount':len(g['filesInOrder'])} for i,g in enumerate(groups,1)],
            'runtimeReconciliationPassed':not differences and not resource_differences and all(image_matches.values()),
            'projectResourceModelsEqual':not resource_differences,'projectResourceDifferences':resource_differences,
            'imageDriftKinds':image_drift,'nonImageServiceModelsEqual':not differences,'nonImageDifferences':differences,
            'selectedCachedImageMatchesLive':image_matches,'allSelectedImagesMatchLive':all(image_matches.values()),
            'explicitRestartOverrideRequired':sorted(restart_overrides),'interpolationPerformed':False,
            'environmentFilesResolved':False,'registryContacted':False,'imagesPulled':False,'overridesApplied':False,
            'actualDeploymentPerformed':False,'automaticDeploymentAllowed':False,
            'blockers':(['non-image-model-differences'] if differences or resource_differences else []) + (['declared-vs-live-image-drift'] if image_drift else []),
            'remainingChecks':['resolved-environment-and-secret-custody','init-and-migration-service-image-binding',
                               'single-release-overlay-isolated-rehearsal','signed-main-publication-and-fresh-recovery',
                               'stateful-upgrade-compatibility-and-approved-transition']}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args();report={'completed':False,'readOnly':True,'actualDeploymentPerformed':False,'automaticDeploymentAllowed':False}
    try:
        output=args.output.resolve();require(output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
        report=analyze()
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
    except Exception:
        report.update(completed=False,code='RUNTIME_RECONCILIATION_UNVERIFIED')
    # Only aggregate status is printed; the sanitized per-service report remains private.
    print(json.dumps({k:v for k,v in report.items() if k not in ('groups','nonImageDifferences','selectedCachedImageMatchesLive','explicitRestartOverrideRequired','remainingChecks','imageDriftKinds','projectResourceDifferences')}))
    return 0 if report['completed'] else 1


if __name__=='__main__':sys.exit(main())
