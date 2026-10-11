# 개발 PostgreSQL 암호화 복원 훈련

`python scripts/stack-database-backup-smoke.py`는 새 `stack-db`의 스냅샷을 암호화한 뒤 별도 일회성 PostgreSQL 컨테이너에 복원한다. 기존 DB나 볼륨에 복원하지 않는다. 실행 중인 원래 서비스·LogiTrack은 대상이 아니다.

먼저 Compose 프로젝트와 서비스 정체성, 실행 상태와 미완료 평가를 검사한다. admission의 `queued` 상태는 불변이므로 별도 completion 행과 결합해 실제 미완료를 판단한다. 새 Core/워커만 잠시 정지하고 모든 public 테이블의 행 수와 SHA-256을 DB 안에서 계산한다. 행 원문은 출력하지 않는다. 테이블당 10만 행·16 MiB, 전체 측정 64 MiB, dump 32 MiB 및 디스크 여유 한도를 적용한다.

`pg_dump` custom archive는 메모리에서 AES-256-GCM으로 암호화한다. 평문 dump를 호스트 파일로 저장하지 않는다. 암호화 도구는 고정 보안 이미지의 실제 image ID로 실행하며 네트워크·Docker socket·registry 자격 증명 없이 읽기 전용 스크립트와 임시 키만 마운트한다. Linux는 호스트 비루트 UID/GID를 사용하고 파일은 소유자 전용이다. 이 임시 개발 키는 운영 KMS나 복구키 보관 절차를 대신하지 않는다.

복원 대상은 원본과 동일한 PostgreSQL/pgvector image ID, 비루트 UID, 읽기 전용 rootfs, 전용 새 볼륨과 network `none`을 사용한다. 호스트 포트를 열지 않는다. API 역할은 원본 암호를 복사하지 않는 제한된 NOLOGIN 역할로 만든다. 모든 public 테이블의 복원 fingerprint, pgvector 질의, 정확한 RLS 정책, 범위 없는 조회 거부와 append-only 권한을 검사한다.

로컬 훈련에서 15개 테이블·3,736개 행의 일치, vector 0.8.7 질의, 자기 조직 조회·다른 조직/범위 없는 조회 거부·권한 보존, 기존 source fingerprint 불변을 확인했다. 종료 시 새 Core/워커의 건강 상태를 복구하고 소유 UUID label을 대조한 임시 컨테이너·볼륨·키·환경 파일만 제거했다. 이후 기능 검증이 추가로 만든 행은 이 복원 표본에 포함되지 않는다. 암호화 경계 테스트 7개는 nonce·ciphertext·header 변조, 다른 키, 잘린 입력과 envelope 크기 제한을 검증한다.

CI에는 소스 실행과 정확한 registry 이미지 실행의 복원 훈련을 추가했다. 업로드하는 것은 비밀이 없는 `summary.json`뿐이다. 암호화 archive·개발 키·fixture 환경 파일은 artifact에 포함하지 않는다. 원격 통과 여부는 해당 CI가 완료한 뒤 별도로 확인한다.

암호화 도구는 각 실행 환경에서 먼저 `docker build -t agenttrust-security:local tools/security`로 준비한다. GitHub Actions의 다른 job에서 만든 로컬 이미지는 전달되지 않는다. 소스 CI 38105472954는 이 이미지가 없어서 암호화 스냅샷 단계에서 실패했으며 source 서비스 복구·fixture 정리는 확인됐다. 각 백업 job의 빌드와 서비스 정지 전 이미지 preflight를 추가했으며, 수정 후 원격 통과 결과는 별도 확인한다.

이 결과는 개발 DB의 제한된 복원 훈련이다. Keycloak 인증 정보, MinIO 증거 바이트, JetStream의 메시지·consumer 상태, 서명 키, Redis와 운영 설정의 일관된 전체 복원은 검증하지 않았다. 새 DB에서 API를 실행한 복구, HA, 실제 RPO/RTO, 운영 키 관리 및 정기적인 원격 백업도 남아 있다. 임시 키를 제거한 암호화 파일은 보관용 운영 백업이 아니다.

## MinIO 개발 복원 훈련

`python scripts/stack-object-backup-smoke.py`는 자기 세션으로 합성 평가와 승인 보류 상태를 만든 뒤 고정 버전의 증거를 확인한다. 새 MinIO의 프로젝트·서비스·볼륨을 대조하고 잠시 정지해 읽기 전용 volume snapshot을 얻는다. 원래 서비스는 fixture 작업 전에 복구한다. snapshot은 AES-256-GCM으로 암호화하며 평문 호스트 파일을 만들지 않는다.

복원 전 tar의 크기·경로·파일 종류·중복·확장 권한을 검사한다. 다른 prefix, 절대/상위 경로, 링크·장치·FIFO·setuid/setgid 파일을 거부한다. 정상적인 `/tmp` volume root의 sticky bit는 디렉터리에만 보존한다. 새 UUID label의 빈 볼륨에만 복원하고 모든 일반 파일의 SHA-256·크기를 원본과 비교한다. 복원 컨테이너는 원본 MinIO의 실제 image ID와 비루트 UID를 사용하며 전용 internal network 외에 연결하거나 호스트 포트를 열지 않는다.

로컬에서는 499개 파일의 fingerprint 일치와 실제 MinIO 실행을 확인했다. 복원된 IAM의 객체 목록·삭제 거부, 정확한 증거 version ID와 바이트 해시, 7일 COMPLIANCE 잠금과 root의 잠긴 버전 삭제 거부, 새로운 shadow 버전 이후에도 기존 고정 버전 유지가 통과했다. 원래 저장소에서도 동일 고정 버전과 해시를 읽고 승인 보류 상태를 재확인했다. 저장소 재시작 직후의 일시적인 409/503만 최대 30초 동안 재조회하며 지속적 오류나 다른 상태는 실패다. 소유한 fixture 컨테이너·네트워크·볼륨·임시 키와 자체 로그인 세션을 정리했다.

archive 경계 테스트 6개가 통과했다. CI는 개발 DB와 MinIO 복원 훈련을 각각 실행하고 공개 요약만 업로드한다. 두 훈련은 독립 스냅샷이므로 DB와 객체 저장소 사이의 한 시점 일관성, 인증·메시지·서명 키를 포함한 전체 시스템 복구, 실제 운영 복구키 보관이나 RPO/RTO를 증명하지 않는다.
