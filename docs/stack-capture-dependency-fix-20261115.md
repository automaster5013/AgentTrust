# 촬영 후보의 high 의존성 취약점 수정 — 2026-11-15

사용자가 보안 검사를 유지하면서 high 취약점을 해결하는 의존성 수정을 허용한 범위다. 기존 복구 환경·원본에 적용하지 않는다.

## 변경과 검증

- Promptfoo 직접 의존성 `0.124.1`, 기존 override와 감사 기준을 유지했다. `npm audit fix --package-lock-only --ignore-scripts`로 호환 범위의 전이 의존성 14개 버전을 갱신했다. force 옵션이나 감사 생략은 사용하지 않았다.
- 갱신에는 fast-uri `3.1.8`→`3.1.9`, undici `6.29.0`→`6.29.1` 및 `8.11.2`→`8.12.4`, zod의 패치 버전 갱신 등이 포함된다. 정확한 내용은 커밋의 lockfile을 따른다.
- 새 lockfile의 `npm ci --ignore-scripts --omit=optional`이 통과했다.
- `npm audit --omit=optional --audit-level=high`가 종료 코드 0으로 통과했다. 확인 시 high 0·critical 0이며 moderate 8개는 남아 있다. 전체 취약점 0으로 표시하지 않는다.
- 현재 개발 소스의 Node 검사 18개(기존 provider, 실제 Promptfoo 평가·HTTP 계약, connector 규칙·HTTP 계약)가 통과했다.
- 독립 촬영 환경에서 수정된 lockfile을 사용한 기존 quality Dockerfile의 8개 검사와 동일 high 감사, 최종 이미지 빌드가 통과했다.
- 촬영 후보의 Python Docker 빌드에서 110개 검사가 통과했다. Windows의 별도 Python에는 nats 패키지가 없어 해당 환경의 unittest import는 실패했으며, 이를 통과로 합산하지 않는다.

## 지문과 소스 범위

lockfile에 결합된 quality 프로필 4개를 함께 갱신하고 기존 생성기의 check를 통과했다. connector 프로필 4개도 새 lockfile에 결합했다. connector worker 지문은 **커밋된 HEAD의 소스**로 계산했으며, 보존 중인 미커밋 한 줄 변경을 포함하지 않았다. 미커밋 worker와 저장 프로필이 일치한다고 주장하지 않는다.

기존 저장 버전·업무 데이터·과거 수용 기록을 다시 쓰지 않는다. 변경된 프로필은 새 소스의 기본 실행 정체성이며 기존 정확 SHA의 수용을 새로운 SHA의 수용으로 재사용하지 않는다. 15번째 기능은 여전히 미수용 후속 범위다. 이전에 거부된 verifier 분리 작업은 재시도하지 않았다.

실제 촬영 후보는 수용된 `23c810c769a59477308d3fd3df7aba39c2487bb4`의 소스 아카이브에 새 lockfile과 그에 따른 quality 프로필 갱신을 적용한 구성이다. 현재 브랜치의 15번째 기능과 미검증 worker 변경은 촬영 소스에 넣지 않는다. 앱 동작을 수정하거나 과거 소스 그대로의 재수용이라고 표시하지 않는다.

## 별도 완료 조건

의존성 수정과 이미지 빌드 성공은 실제 영상·자막·공개 검토 완료를 뜻하지 않는다. 실제 촬영 결과와 산출물 해시는 후속 기록으로 구분한다. 현재 복구 서비스 적용·운영 배포·새 CI 실행은 수행하지 않았다.
