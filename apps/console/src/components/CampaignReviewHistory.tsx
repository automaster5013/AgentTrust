import type {Identity} from '../lib/contracts';
import ReviewHistoryWorkspace from './ReviewHistoryWorkspace';
export default function CampaignReviewHistory({user,campaignId,disabled}:{user:Identity;campaignId:string;disabled:boolean}){
 return <ReviewHistoryWorkspace user={user} resource="campaigns" recordId={campaignId} disabled={disabled}/>;
}
