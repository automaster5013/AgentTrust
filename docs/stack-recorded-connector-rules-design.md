# 기록된 도구 관측·구조화 출력 규칙 — 다음 제한 계약

2026-11-12 구현 전 계약 검토다. 아직 이 기능의 소스 구현·후보 수용·운영 적용을 완료하지 않았다. 이미 수용한 `recorded-text-rules-v1`의 지문·의미·실행 경로는 유지한다.

## 4310과의 실제 차이

`packages/evaluator/index.js`의 `allowed_tools`는 이름 목록 검사에 더해 관측 부재·잘못된 이벤트를 inconclusive로, 허용 밖 도구 또는 인자 스키마 실패를 fail로 처리한다. 빈 이벤트 배열은 관측된 도구 호출이 없다는 뜻으로 pass다. `json_schema`는 기록 출력 문자열을 JSON으로 읽은 뒤 스키마로 검사한다.

`packages/contracts/index.js`의 기존 `compileEvidenceSchema`도 전체 JSON Schema가 아니다. 참조·정규식·사용자 코드·원격 해석을 금지하고 13개 키워드, 깊이6·properties30개 등으로 제한한 Ajv strict 계약이다. 새 플랫폼에서 단순 도구 이름 비교만 구현하고 기존 기능 전체와 동등하다고 표시하지 않는다.

첫 범위는 `examples/connector-contract/acceptance-profile.json`의 두 합성 관측에 쓰인 문자열 규칙·도구 목록·평면 문자열 객체 스키마를 실제 등록→실행→근거 조회로 연결하는 것이다. 기존 관리자 정책과 전체 connector 설정 이전은 포함하지 않는다. 기록된 도구 관측을 실제 도구 호출이나 연결 권한으로 취급하지 않는다.

## 새 불변 계약과 지원 범위

새 계약은 `recorded-connector-rules-v1`, provider는 기존 synthetic, DB 평가 분류는 quality를 사용한다. 새 DB 시나리오·마이그레이션·계정·인증 설정·OPA 권한 변경은 없다. 기존 버전의 정의·프로필을 덮어쓰거나 이전 문자열 평가 코드를 새 규칙으로 해석하지 않는다.

지원 규칙은 contains/not_contains, allowed_tools, json_schema다. 각 종류별 필드 목록을 정확히 구분한다. allowed_tools의 optional argumentSchemas를 제공하면 실제 검사하며 무시하지 않는다. 지원하지 않는 스키마·필드·키워드는 등록 단계에서 거부한다.

스키마는 **평면 문자열 객체**로 제한한다. 루트 type:object, properties(최대8개)의 각 type:string, 선택 enum(최대8개 문자열), minLength/maxLength, 루트 required와 additionalProperties:false만 지원한다. required는 선언된 properties의 유일한 부분집합이다. 문자열 길이는 Unicode 코드 포인트 수로, 전송·저장 한도는 별도 UTF-8바이트로 센다. 배열·중첩 객체·숫자·조합·참조·정규식·format·커스텀 키워드는 지원하지 않는다. 이 제한은 원래 합성 수용 예제의 인자 orderId와 구조화 출력 status를 표현하지만 기존 4310의 더 넓은 제한 스키마 전체를 대체하지 않는다.

관측은 output과 toolEvents를 별도로 결합한다. 관측 누락을 표현하는 명시적 null과 빈 문자열/빈 배열을 구분한다. 잘못된 도구 관측은 해당 도구 규칙 inconclusive이며, 허용 밖 도구와 인자 스키마 불일치는 fail이다. 허용 도구여도 인자가 스키마와 맞지 않으면 pass로 바꾸지 않는다. 전체 필수 규칙의 fail/block, 누락/inconclusive, 선택 실패 보존을 기존 캠페인 판정과 연결한다.

최대2사례·사례당4규칙, toolEvents 최대4개, 허용 도구 최대4개, 객체 인자 최대8개 문자열, input/output 각512 UTF-8바이트, 규칙 값64바이트를 출발 한도로 삼는다. 개별 정규화 사례3072바이트·정의6144바이트·실제 전체 NATS 작업4096바이트·기존 부모 보관16KiB를 함께 확인한다. 추가 JSON escaping·스키마·인자로 한도를 넘으면 거부하며 기존 한도를 늘려 우회하지 않는다.

## 실행 연결과 기존 의존성 재사용

기존 `tools/promptfoo/package-lock.json`에 Ajv8.20.0이 이미 포함돼 있고 C의 기존 설치에도 있다. 새 중복 설치나 lock 변경 없이 기존 검증기 이미지의 Ajv를 재사용할 수 있다. 현재 `quality-server.mjs`의 /grade는 고정된 참조 답안 전용이므로 그대로 임의 스키마를 보내는 방식은 사용하지 않는다.

검토한 경로는 별도 소스 모듈과 서버 진입점에서 기존 verifierServer를 그대로 위임하고, 새 기록 규칙 전용 내부 POST 경로를 기존 작업자 토큰으로 인증하는 것이다. 기존 quality-policy/server/package-lock 지문을 변경하지 않는다. 새 Python 실행 프로필은 새 규칙 코드와 새 검증 모듈·전송 소스·고정 Ajv 버전을 함께 결합해야 한다. 원문을 reason·로그에 복제하지 않고 요청 본문·동시성·실행 시간·응답을 제한한다. 검증기 불가·두 판정 불일치·중복 키 등 모호한 JSON은 fail-closed로 처리한다.

새 Python 소비자는 기존 소비자와 경쟁하지 않는 별도 subject를 사용한다. 기존3개 FILE 스트림48MiB에 새 최대8MiB를 더해 총56MiB로 후보 생성 한도64MB 안에 유지하는 경로를 검토한다. 모든 소비자의 기동·readiness를 합성하고 기존 파일 내구성을 유지한다. 현재 복구 서비스의 컨테이너·설정 파일·토큰에는 적용하지 않는다.

Java는 저장된 부모·agent/dataset·전체 사례·프로필·관측 및 선언된 규칙과 완료 결과를 정확히 결합한다. UI의 기존 카탈로그·사례 근거·보관/서명 파서는 새 계약을 명시적으로 지원해야 한다. 저장만 가능한 버전을 완료로 보고하지 않는다. 후보는 실제 두 예제의 규칙5개와 금지 도구·잘못된 인자·잘못된 JSON·필수 누락·빈 관측·scope/role/late·실제403·원본 불변을 검증해야 한다.

## 확인한 공식 의미

Ajv의 기본 export는 draft-07이며 strict 모드는 알 수 없거나 무시되는 스키마 구성을 거부하는 데 사용한다. [Ajv JSON Schema](https://ajv.js.org/json-schema.html), [Ajv strict 모드](https://ajv.js.org/strict-mode.html). 객체 properties 선언만으로 필수 여부를 만들지 않으며 required와 추가 속성 제한을 별도로 지정해야 한다. [JSON Schema 객체 설명](https://json-schema.org/understanding-json-schema/reference/object). 위 지원 부분집합은 이 의미를 좁혀 명시한 제품 계약이며 전체 표준 지원 주장이 아니다.
