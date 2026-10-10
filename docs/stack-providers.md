# 실제 로컬 모델과 공급자 어댑터

```powershell
docker build -t agenttrust-local-model:local services/local-model
python scripts/stack-provider-setup.py
python scripts/stack-provider-start.py
python scripts/stack-provider-integrity-smoke.py
python scripts/stack-provider-smoke.py
```

Ollama 0.40.2의 소스 commit `b061384d90ff455462bc32745dd0de479de717a3`·archive SHA-256과 공식 CPU 추론 라이브러리 archive SHA-256을 고정한다. 실행 바이너리는 Go 1.27.2와 수정 라이브러리로 재빌드하며 GPU 라이브러리를 포함하지 않는다. 기존 공식 이미지의 Go 의존성에서 HIGH/CRITICAL 50건이 발견되어 예외 없이 수정했고 같은 검사에서 0건을 확인했다. CPU 이미지 약 263MB이며 최초 공식 이미지 약 9.36GB의 GPU 부분을 포함하지 않는다. 전달 시 로컬 모델을 포함한 열 이미지 모두 검사·서명한다. 최초 준비 컨테이너만 모델 다운로드 네트워크를 사용하고, 실행 서비스에는 내부망·호스트 포트 없음·cloud 비활성·비루트 사용자·읽기 전용 모델 볼륨·CPU 2·메모리 1.5GiB를 적용한다. 기존 서비스·볼륨은 삭제하지 않는다. 모델 준비에는 약 523MB와 빌드 단계 공식 archive 약 1.4GB 다운로드 공간이 필요하다.

`qwen3:0.6b`의 원본 manifest는 `sha256:7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435`다. Ollama 0.40.2는 원본 manifest를 layer로 감싼 저장 파일을 만들므로 디스크 포장 manifest의 SHA-256 `6f76d4346c34ba89df6e137fb661b4bb4daf322c1151b6ef0dfda981070a851f`도 따로 고정한다. 준비와 daemon 시작 전에 포장 manifest·설정·가중치·template·license·params·원본 manifest의 7개 파일 SHA-256을 모두 검사하며, 실제 `/api/tags`의 원본 digest도 확인한다. 정상 읽기 전용 볼륨 검증과 별도 손상·누락 fixture의 실행 거부 3개 검사를 통과했다. 기존 모델 파일을 변경하지 않는다. 태그 이름만 일치하면 허용하는 방식이 아니다.

Next.js에서 실행 공급자를 고르면 Java admission의 불변 `provider`에 기록되고 NATS 작업과 결과 engine을 대조한다. 공급자 변경에 같은 멱등성 키를 사용하면 409다. 기존 합성 요청의 fingerprint는 유지한다. 단순 내부 `/evaluate` 주소는 실제 공급자 호출을 허용하지 않으며, NATS 워커가 인증된 Java 예약을 받은 경우만 실행한다.

각 실행의 예약은 DB에서 한 번만 생성한다. 조직·프로젝트 advisory lock과 RLS로 각 조직·프로젝트 조합에 대해 하루 UTC 기준 모든 모델 공급자 합계 100회를 제한한다. 조직 전체나 여러 프로젝트를 합산한 과금 한도는 아니다. 1회 입력은 고정 ASCII prompt 256바이트 이하, 예약 입력 256 tokens와 출력 128 tokens다. 실제 HTTP 요청도 출력 128 token 상한과 로컬 모델 전체 60초·유료 공급자 전체 20초·연결/쓰기/연결 대기 2초·응답 8KiB·생성 텍스트 2KiB 제한을 적용한다. 로컬 모델 초기 로딩·추론이 합쳐서 60초를 넘으면 실패한다. CPU 모델의 냉간 로딩은 기존 20초 제한을 넘는 실제 사례가 있어 로컬 한도만 변경했다. 모델 실행 중 5초 간격의 NATS progress 갱신을 보내되 결과 저장 전 ACK하지 않는다. 예약 응답 손실이나 워커 재시작 후에는 새 유료 호출을 자동 재시도하지 않는다. 사용한 예약은 실패에도 반환하지 않으며 이 상한이 금액 기준 과금 보장을 뜻하지는 않는다.

모델 자체의 판정 문장을 믿지 않고 고정 JSON의 `answer`가 `READY`인지 자체 평가기가 확인한다. `DENIED`는 필수 실패, 빈 근거는 판정 불가다. 네 합성 시나리오는 작은 계약 시연이며 일반적인 에이전트 품질·안전성 평가가 아니다. 원본 생성 텍스트는 DB/MinIO/로그에 저장하지 않고 SHA-256·공급자/모델 식별과 고정 규칙 결과를 보관한다. 검색 특징은 계속 규칙 특징 해싱이며 AI 의미 임베딩이 아니다.

로컬 실제 검증은 Ollama의 세 판정·OpenAI 호환 `/v1/chat/completions` 추론·관리자 승인·조직 경계·멱등성·1회 예약과 공급자 비활성의 거부를 포함한 7개다. 마지막 검사는 재시작한 워커의 헬스 준비 후 새 합성 근거가 실제로 처리되는지 확인한다. 별도 실제 headless 브라우저에서도 모델 공급자 선택→완료 근거→승인→공급자에 결합된 보관본 해시 검증→반려 후 차단을 확인했다. 스크린샷·trace·video를 생성하지 않는다. 호환 API는 현재 고정된 로컬 Ollama 주소만 지원하며 임의 외부 호환 서버 설정은 미구현이다. JSON mode와 `reasoning_effort=none`을 사용하고 잘린 응답·잘못된 digest·리다이렉트·중복 JSON·도구 호출은 허용하지 않는다.

OpenAI 어댑터는 공식 `https://api.openai.com/v1/responses`, `store=false`, 도구 없음, 고정 출력 한도를 사용한다. 무작위 미발급 키의 MockTransport 계약으로 요청과 불완전 응답의 거부를 검증했다. 기본 실행은 유료 공급자를 비활성화하며 OpenAI 키·모델·외부 egress를 구성하거나 실제 과금 호출을 수행하지 않았다. 별도 운영자 구성과 실제 계정 검증 전에는 OpenAI 실연동 완료로 소개하지 않는다. `store=false`는 공급자의 모든 데이터 보존을 없앤다는 뜻이 아니다. 모델 출력의 원본 보존·가격별 예산·사용량 정산·범용 데이터셋·대규모 부하는 남은 범위다.

- [공식 OpenAI Responses 전환과 저장 설정](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Ollama generate](https://docs.ollama.com/api/generate)
- [Ollama OpenAI 호환 규약](https://docs.ollama.com/api/openai-compatibility)

새 에이전트 v2 버전은 [캠페인 계약](stack-campaigns.md)의 고정 실행 프로필을 저장한다. Python이 실제 설치 상태와 일치하는지 모델 예약 전에 검사한다. 기존 단일 평가와 v1 캠페인은 이 추가 고정 계약을 소급 적용하지 않는다. `python scripts/stack-execution-profile-smoke.py`는 새 프로필의 실제 일치, 기존 버전 재등록 보존, 과거 프로필 불일치 시 호출/예약 0회를 검증한다.
