import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'AgentTrust · 평가와 릴리스 검토',description:'평가 근거를 확인하고 현재 릴리스 요구를 검토합니다.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
