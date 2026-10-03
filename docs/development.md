# 로컬 개발과 API 계약

## 실행

Node.js 24가 필요하다. 검증 환경은 Windows와 Node 24.15.0이다.

```powershell
Set-Location C:\AgentTrust
npm.cmd ci --cache .cache/npm
npm.cmd start
```

브라우저에서 `http://127.0.0.1:4310`을 연다. `localhost` 별칭은 Host 검증으로 거절된다. 포트는 `.env.example`을 참고해 `.env`에 설정할 수 있다. 바인딩 주소는 항상 127.0.0.1이며 공개 배포용 설정은 없다.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd audit --cache .cache/npm
```

## 구현 범위

이 버전은 Node ESM JavaScript, Node HTTP 서버, 일반 HTML/CSS/JavaScript, Ajv 8.20.0을 사용한다. 첫 평가 흐름의 계약과 동작을 빠르게 검증하기 위해 빌드 도구 없이 구성했다. TypeScript·DB·큐를 이용한 운영 구조는 다음 구현 단계에서 도입한다. 고정 종속성과 package-lock.json을 사용한다.

합성 샘플 3개, 모의 에이전트 6개, 기본 정책이 시작 시 등록된다. 화면에서 JSON 데이터셋의 새 버전을 저장하고 에이전트·데이터셋·정책을 선택해 실행할 수 있다. 결과에는 사례별 입력/출력/도구 이벤트/규칙 근거와 게이트, 실행 스냅샷, SHA-256 해시가 포함된다. 결과 JSON을 내려받을 수 있다.

버전과 완료된 실행은 메모리에서 불변이며 조회 응답은 복제된다. 키 순서를 정규화한 JSON으로 해시한다. 메모리 큐는 setImmediate 기반으로 실행하며 외부 도구를 호출하지 않는다. 오류 시 fail-open하지 않는다.

모의 mode: compliant, regression, forbidden_tool, error, missing_evidence, unsafe_output.

## 요청 계약

조회: `GET /health`, `/v1/catalog`, `/v1/sample-dataset`, `/v1/runs`, `/v1/runs/{id}`, `/v1/runs/{id}/results`, `/v1/runs/{id}/gate`.

생성: `POST /v1/agent-versions`, `/v1/dataset-versions`, `/v1/policy-versions`, `/v1/runs`.
모든 POST에 `Content-Type: application/json`, `X-AgentTrust-Request: local-ui`가 필요하다. 이는 교차 사이트 요청 방어용이며 인증 자격이 아니다. 조직 인증은 아직 없다.

실행 본문: `{ "agentVersionId": "...", "datasetVersionId": "...", "policyVersionId": "..." }`.
실행 생성에는 8~100자의 영문/숫자/하이픈/밑줄 `Idempotency-Key`가 필요하다. 최초 202, 동일 요청 재사용 200, 다른 요청으로 재사용 409를 반환한다.

규칙: contains/not_contains의 value, json_schema의 schema, allowed_tools의 allowed와 선택 argumentSchemas. required를 생략하면 필수다. 각 사례는 최소 하나의 필수 규칙이 필요하다. 필수 규칙 실패가 있으면 block, 필수 증거 누락이나 실행 오류는 inconclusive(이미 필수 실패가 확인됐다면 block), 나머지는 minimumPassRate 기준을 적용한다. pass만 deploymentAllowed=true다. 실행 성공과 게이트 통과는 별도다.

JSON Schema 지원은 제한된 하위 집합이다: type, properties, required, additionalProperties(boolean), items, enum, minimum/maximum, minLength/maxLength, minItems/maxItems. 중첩 깊이 6, 객체 속성 30, enum 항목 30까지. 참조, 정규식, 외부 스키마, 사용자 키워드, format은 거절한다.

입력 한도: 요청 256 KiB, 데이터셋 100개 사례, 사례당 20개 규칙/도구 이벤트, 원문 문자열 10,000자. 메모리 한도: 각 버전 종류와 실행은 세션당 500개. 초과 시 429를 반환한다. 원문은 합성 데이터만 입력한다.

## 보안 경계와 현재 제한

루프백 바인딩, 정확한 Host 검사, Origin 검사, JSON+커스텀 헤더, CSP, textContent 렌더링을 적용한다. 파일 제공은 세 개의 정적 자산 허용목록으로 제한한다. 평가 대상 출력은 HTML로 해석하지 않는다.

DB 영속성, 외부 어댑터, 실제 인증/조직 격리, 워커 프로세스/lease, 취소·시간 초과·예산 계량, 감사 저장, CI 배포 연결은 아직 구현하지 않았다. 서버 재시작은 전체 세션을 초기화한다. 결과 해시는 변조 탐지용 비교값이며 디지털 서명 또는 독립 감사 증거를 대체하지 않는다. 상용화 전 로드맵의 게이트는 계속 적용된다.

참고 공식 문서: [Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html), [Ajv](https://ajv.js.org/guide/getting-started.html).
