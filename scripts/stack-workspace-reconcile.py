"""Review a protected provisioning journal; --inspect-local performs only account reads."""
import argparse,datetime,json,os,pathlib
from stack_backup_custody import windows_owner_only
from stack_identity_scope_contract import verify
from stack_workspace_identity import LocalWorkspaceIdentity
from stack_workspace_onboarding import parse_manifest,require
from stack_workspace_reconciliation import journal_for_review,inspect_journal

ROOT=pathlib.Path(__file__).resolve().parent.parent
def local_file(value,private=False):
    path=pathlib.Path(value)
    if not path.is_absolute():path=ROOT/path
    require(not path.is_symlink() and not path.parent.is_symlink())
    path=path.resolve(strict=True)
    require(path.is_relative_to(ROOT/'.local') and path.is_file() and 0<path.stat().st_size<=32768)
    if private:
        if os.name=='nt':windows_owner_only((path,path.parent))
        else:
            for item in (path,path.parent):require(item.stat().st_uid==os.getuid() and item.stat().st_mode&0o077==0)
    return path
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',required=True);parser.add_argument('--journal',required=True);parser.add_argument('--inspect-local',action='store_true');args=parser.parse_args()
    report={'completed':False,'localDevelopmentOnly':True,'identityConfigurationWritesPerformed':False,'originalJournalModified':False,'rawCredentialsPrinted':False,'productionIdentityConfigured':False}
    try:
        manifest=parse_manifest(local_file(args.manifest).read_bytes())
        cohort=journal_for_review(local_file(args.journal,True).read_bytes(),manifest)
        report.update(manifestSha256=cohort['manifestSha256'],journalStage=cohort['stage'],journalMemberCount=len(cohort['members']),unattemptedMembers=cohort['unattemptedMembers'],originalProvisioningCompleted=cohort['originalProvisioningCompleted'],createResponseUncertain=cohort['createResponseUncertain'])
        if not args.inspect_local:report.update(completed=True,stage='journal-reviewed-no-provider-contact',providerContactPerformed=False)
        else:
            with LocalWorkspaceIdentity(ROOT) as api:
                clients=api.read('/clients?clientId=agenttrust-console');require(isinstance(clients,list) and len(clients)==1)
                verify(clients[0],api.read('/users/profile'))
                report.update(inspection=inspect_journal(api,cohort),providerContactPerformed=True)
            report.update(completed=True,stage='local-account-inspection-completed',operatorAuthenticationSessionClosed=True)
    except Exception as error:report.update(completed=False,errorType=type(error).__name__,code=getattr(error,'code','WORKSPACE_RECONCILIATION_UNVERIFIED'))
    report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
