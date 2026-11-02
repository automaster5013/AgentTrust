import React from 'react';
import {createRoot} from 'react-dom/client';
import CampaignHistorySearchWorkspace from '../apps/console/src/components/CampaignHistorySearchWorkspace';
import WorkspaceTop from '../apps/console/src/components/WorkspaceTop';
const user={username:'synthetic-viewer',role:'viewer',organizationId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',actorId:'33333333-3333-4333-8333-333333333333'} as const;
createRoot(document.getElementById('root')!).render(<><WorkspaceTop user={user} busy={false} onLogout={()=>{}}/><CampaignHistorySearchWorkspace user={user} disabled={false} datasetVersionId={null} selectedCampaignId={null} onSelect={id=>{document.getElementById('selected')!.textContent='캠페인 '+id}} onBaseline={()=>{}}/><p id="selected"/></>);
