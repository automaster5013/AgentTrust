# 4320 공개 소개 화면

2026-11-02 사용자 요청으로 `/`의 첫 화면을 AgentTrust showcase로 구성했다. `/showcase`도 같은 소개를 표시한다. 종이색 바탕·검토 노트·근거에서 결정으로 이어지는 흐름을 사용하며, LogiTrack은 소개에서 작업공간으로 진입하는 구조만 참고한다.

소개는 서버에서 렌더링하는 정적 콘텐츠이며 로그인·조직 정보·업무 API를 조회하지 않는다. 예시 판정은 운영 자료가 아니라고 표시한다. 실제 기능은 기존 사이드바가 있는 `/workspace`에서 기존 인증과 권한으로 사용한다.

OIDC의 기존 issuer·callback·쿠키·Core 설정은 유지한다. Console BFF가 성공 callback의 기존 정확한 application root Location을 검증한 후, 고정된 동일 origin의 `/workspace`로 연결한다. 임의 return URL이나 외부 redirect는 허용하지 않는다. 로그아웃의 복귀 주소는 기존 `/`이며 소개 화면을 표시한다. 이전 Core에도 같은 계약을 사용한다.

`scripts/showcase-ui-review.cjs`는 실제 컴포넌트와 CSS의 320/390/768/1440px 화면·가로 넘침·키보드 진입·외부 요청 없음을 검사한다. 실제 공개 첫 화면과 로그인 후 작업공간의 연결은 Playwright에서 별도로 검사한다. 소스 구현과 실제 운영 이미지 적용은 구분하며, 기존 자료나 DB 이전은 이 변경에 포함하지 않는다.

이전·이후 화면을 대조하는 hosted 검사는 고정된 과거 Console `74f7875`도 실행한다. 과거 이미지에는 showcase나 `/workspace` 진입점이 없으므로, 정확한 baseline revision을 명시한 hosted `before` 검사만 기존 `/` 로그인 복귀를 사용한다. 새 후보와 일반 검사는 계속 showcase 첫 화면과 `/workspace` 복귀를 요구한다. baseline pin 누락·치환·로컬 사용·후보에 과거 모드 적용은 거부한다. 이 구분은 제품 인증/권한이나 redirect allowlist를 완화하지 않는다.
