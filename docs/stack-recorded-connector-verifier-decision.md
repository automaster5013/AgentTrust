# 기록 규칙 검증기 의존성 — 필요한 변경 범위

## 확인된 장애

세 번째 후보 run 43233246778의 Node 기능 검사 16개는 통과했지만 기존 Promptfoo 잠금 의존성의 npm audit high 검사가 실패했다. 최초 등록·실행 흐름의 새 E2E 수용은 아직 없다. 기존 수용된 reference verifier 소스·잠금 지문을 보존하면서 보안 게이트를 통과해야 한다.

공식 GitHub Advisory에서 [body-parser 고위험 취약점](https://github.com/advisories/GHSA-27r3-jxmh-p828)을 확인했다. 또한 Ajv 전이 의존성인 fast-uri는 [3.1.9 수정 안내](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)를 확인했다. 기존 전체 Promptfoo lock을 업데이트하거나 보안 검사를 제외하는 변경은 하지 않았다.

## 소스·후보 CI 한정 제안

1. 새 `tools/connector-verifier` 소스 디렉터리에서 Ajv 8.20.0과 필요한 최소 전이 의존성만 별도로 잠근다. 로컬 node_modules를 설치하지 않고 잠금 메타데이터를 검증한다. 후보 이미지의 설치와 보안 검사는 그대로 수행한다.
2. 현재 새 connector JS 모듈을 이 디렉터리로 이동해 기존 reference grade 위임을 제거한다. 새 서비스는 건강 상태와 인증된 기록 규칙 판정만 제공한다. 기존 worker token 계약을 재사용하고 토큰 값·계정·인증 설정은 변경하지 않는다.
3. 새 검증기 이미지·Compose 서비스 소스와 worker의 고정 내부 대상 주소를 연결한다. 후보 workflow만 이를 빌드·기동하고 외부 모델을 시작하지 않는다. 기존 quality Dockerfile과 잠금 파일은 보존한다.
4. 새 코드·잠금 의존성의 지문을 새 connector profile에 결합한다. 기존 수용된 fixed/reference/recorded-text profile은 그대로 둔다.
5. 보안 검사, 실제 Ajv와 Python 판정 일치, strict schema, 1초 평가·4초 전송 한도 및 불일치 거부를 유지한다. 새 실제 편집자·조회자 E2E와 artifact 검증 후에만 수용한다.

## 적용 범위와 현재 상태

위 제안의 소스 변경은 자동 승인 검토에서 `blocked by policy`로 거부돼 아직 적용하지 않았다. 실제 복구 환경의 컨테이너·서비스·원본·R/T·압축 사본·DB·인증 설정·배포는 변경하지 않는다. 새 서비스의 운영 기동·배포, 기존 Promptfoo 전체 취약점 수리나 운영 전환을 이 제안에 포함하지 않는다. 기존 마감 2026-11-13 07:58:37 KST를 유지한다.
