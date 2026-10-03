# 로컬 PostgreSQL 백업·복원 검증

v0.6은 Docker agenttrust DB를 일관된 PostgreSQL 스냅샷에서 custom-format dump로 백업하고, 별도 데이터베이스에서 복원을 검증한다. 운영 DB 위에 덮어쓰거나 LogiTrack 자산을 변경하지 않는다.

`npm run backup`은 `.local/backups/agenttrust-<UUID>.dump`와 manifest를 생성한다. `npm run backup:verify -- agenttrust-<UUID>.dump`는 이미 만든 파일을 검증·복원한다. `npm run backup:roundtrip`은 두 작업을 순서대로 실행한다. Docker Desktop과 setup으로 생성한 로컬 소유자 연결 설정이 필요하다.

pg_export_snapshot을 repeatable-read 트랜잭션에서 유지하면서 pg_dump에 전달해, 테이블 지문과 dump가 같은 시점의 데이터를 사용한다. 바이너리 스트림을 직접 파일에 기록하여 PowerShell 문자열 리다이렉션으로 인한 손상을 피한다. 파일 checksum과 각 테이블의 행 수·내용 해시, 마이그레이션 checksum을 manifest에 저장한다. 신규 백업은 AES-256-GCM으로 스트리밍 암호화한다. 매 백업마다 새로운 256비트 키와 96비트 nonce를 만들며, manifest의 데이터 지문·보안 지문·파일 식별자를 인증 추가 데이터에 포함한다. 키는 `.local/backup-keys/<dump 이름>.key`에 저장하고 dump와 함께 공유하지 않는다.

복원 전에 파일 이름·루트 경로·manifest checksum을 확인한다. 암호화 백업은 private 디렉터리의 임시 파일로 완전히 복호화하고 GCM 인증에 성공한 뒤에만 복원 DB를 생성한다. 인증 실패 시 임시 파일을 제거한다. 정상·실패 복원 종료 시에도 평문 임시 파일을 제거한다. 프로세스 강제 종료 시 `authenticated-<UUID>.partial`이 남을 수 있으므로 해당 private 디렉터리를 관리해야 한다. 복원 DB 이름은 항상 새 `agenttrust_restore_<무작위>`이며 --single-transaction과 --exit-on-error로 pg_restore를 실행한다. 복원 시 함수 소유자·권한을 유지한다. 신규 manifest에는 테이블 RLS 설정·정책·권한, 함수 정의·실행 역할·search_path, 애플리케이션 역할 속성의 보안 지문을 저장한다. 복원 후 이 보안 지문과 전체 테이블 지문·마이그레이션이 일치하는지, 조직 컨텍스트 없는 API 역할이 실행을 읽지 못하고 다른 조직의 실행도 보이지 않는지 검증한다. 복원 데이터베이스의 PUBLIC·API·워커 CONNECT 권한을 차단해 복제한 큐 작업이 실행되지 않게 한다. 실패한 복원 DB도 연결 차단 후 진단용으로 남긴다. 결과 report는 private backup 디렉터리에 저장한다.

백업과 manifest/report는 `.local` 아래에 생성하며 Git·Docker build에서 제외한다. Windows에서는 setup이 설정한 해당 디렉터리의 사용자/SYSTEM 전용 ACL을 상속한다. POSIX 파일 권한은 600이다. DB dump는 고객 데이터와 인증용 해시를 포함할 수 있으므로 외부로 공유하지 않는다.

v0.4~v0.5에서 생성한 기존 평문 백업은 보존하며 checksum 기반 복원을 계속 지원한다. 기존 manifest에 보안 지문이 없으면 report의 securityCatalogMatch는 null이다. 신규 백업은 암호화되지만 키도 같은 장치에 있으므로 오프사이트 키 관리가 구현된 것은 아니다. 동일 장치의 디렉터리와 Docker DB에 두는 복원 사본은 장치 장애·랜섬웨어에 대비한 독립 백업이 아니다. 운영 전에 별도 키 보관·저장소·보존 정책·복구 목표·오프사이트 복원 절차와 역할 재생성을 결정해야 한다. 현재 복원은 같은 PostgreSQL 17 클러스터의 이미 존재하는 소유자/API/워커/인증 조회 역할을 사용한다. 운영 자동 백업 스케줄은 만들지 않았다.

2026-10-04 첫 roundtrip 검증 완료: 스냅샷 데이터 지문 일치, 복원된 조직 RLS 확인, 애플리케이션 CONNECT 차단. 실제 파일과 보고서는 `.local/backups`에 보존했다. 관련 옵션은 [PostgreSQL pg_restore 문서](https://www.postgresql.org/docs/17/app-pgrestore.html)를 따른다.

2026-10-04 v0.6 암호화 roundtrip 검증 완료: 데이터·보안 카탈로그 지문 일치, 조직 RLS 확인, 애플리케이션 CONNECT 차단, 키 디렉터리의 사용자/SYSTEM 전용 ACL 확인. 암호화·인증 동작은 [Node.js 24 crypto 문서](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html)를 따른다. CI 인증 조회 함수는 로그인 불가 전용 역할 agenttrust_auth가 실행하며 CI 키·멤버십 읽기만 허용한다. 일반 실행 데이터 읽기와 키 수정은 허용하지 않는다.
