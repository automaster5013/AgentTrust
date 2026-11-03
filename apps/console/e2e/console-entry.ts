import {expect,type Page} from '@playwright/test';
import {workspaceEntry} from '../src/lib/workspace-entry';
export async function openWorkspace(page:Page){
 const entry=workspaceEntry({githubActions:process.env.GITHUB_ACTIONS,visualCapture:process.env.STACK_E2E_VISUAL_CAPTURE,visualLabel:process.env.STACK_E2E_VISUAL_LABEL,baselineRevision:process.env.STACK_E2E_VISUAL_BASELINE_REVISION});
 const initial=await page.goto('/');expect(initial?.status()).toBe(200);
 if(entry.showcase){
  await expect(page.getByRole('heading',{name:/AI의 결과를\s*신뢰의 근거로\./})).toBeVisible();
  await page.getByRole('link',{name:'작업공간 시작하기'}).click();await expect(page).toHaveURL('http://127.0.0.1:4320/workspace');
 }
 return {initial,entry};
}
