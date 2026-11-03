import {test,expect} from '@playwright/test';
test('public showcase is the first page and opens the existing workspace without automatic login',async({page})=>{
 let backend=0;page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/backend/'))backend++});
 for(const path of ['/','/showcase']){await page.goto(path);await expect(page.getByRole('heading',{level:1})).toHaveText(/AI의 결과를\s*신뢰의 근거로\./);await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toHaveCount(0);await expect(page.getByText('합성 예시 · 운영 데이터 아님',{exact:true})).toBeVisible()}
 expect(backend).toBe(0);await page.getByRole('link',{name:'작업공간 시작하기'}).click();await expect(page).toHaveURL('http://127.0.0.1:4320/workspace');await expect(page.getByRole('heading',{name:'워크스페이스 로그인',exact:true})).toBeVisible();
});
