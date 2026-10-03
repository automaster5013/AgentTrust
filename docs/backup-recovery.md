# 로컬 PostgreSQL 백업·복원 검증

v0.4는 Docker agenttrust DB를 일관된 PostgreSQL 스냅샷에서 custom-format dump로 백업하고, 별도 데이터베이스에서 복원을 검증한다. 운영 DB 위에 덮어쓰거나 LogiTrack 자산을 변경하지 않는다.

`npm run backup`은 `.local/backups/agenttrust-<UUID>.dump`와 manifest를 생성한다. `npm run backup:verify -- agenttrust-<UUID>.dump`는 이미 만든 파일을 검증·복원한다. `npm run backup:roundtrip`은 두 작업을 순서대로 실행한다. Docker Desktop과 setup으로 생성한 로컬 소유자 연결 설정이 필요하다.

pg_export_snapshot을 repeatable-read 트랜잭션에서 유지하면서 pg_dump에 전달해, 테이블 지문과 dump가 같은 시점의 데이터를 사용한다. 바이너리 스트림을 직접 파일에 기록하여 PowerShell 문자열 리다이렉션으로 인한 손상을 피한다. 파일 checksum과 각 테이블의 행 수·내용 해시, 마이그레이션 checksum을 manifest에 저장한다.

복원 전에 파일 이름·루트 경로·manifest checksum을 확인한다. 복원 DB 이름은 항상 새 `agenttrust_restore_<무작위>`이며 --single-transaction과 --exit-on-error로 pg_restore를 실행한다. 복원 후 전체 테이블 지문·마이그레이션이 일치하는지, 조직 컨텍스트 없는 API 역할이 실행을 읽지 못하고 다른 조직의 실행도 보이지 않는지 검증한다. 복원 데이터베이스의 PUBLIC·API·워커 CONNECT 권한을 차단해 복제한 큐 작업이 실행되지 않게 한다. 실패한 복원 DB도 연결 차단 후 진단용으로 남긴다. 결과 report는 private backup 디렉터리에 저장한다.

백업과 manifest/report는 `.local` 아래에 생성하며 Git·Docker build에서 제외한다. Windows에서는 setup이 설정한 해당 디렉터리의 사용자/SYSTEM 전용 ACL을 상속한다. POSIX 파일 권한은 600이다. DB dump는 고객 데이터와 인증용 해시를 포함할 수 있으므로 외부로 공유하지 않는다.

현재 백업은 암호화되지 않은 로컬 개발 백업이다. 동일 장치의 디렉터리와 Docker DB에 두는 복원 사본은 장치 장애·랜섬웨어에 대비한 독립 백업이 아니다. 운영 전에 암호화·별도 저장소·보존 정책·복구 목표·오프사이트 복원 절차와 역할 재생성을 결정해야 한다. 현재 복원은 같은 PostgreSQL 17 클러스터의 이미 존재하는 소유자/API/워커 역할을 사용한다. 운영 자동 백업 스케줄은 만들지 않았다.

2026-10-04 첫 roundtrip 검증 완료: 스냅샷 데이터 지문 일치, 복원된 조직 RLS 확인, 애플리케이션 CONNECT 차단. 실제 파일과 보고서는 `.local/backups`에 보존했다. 관련 옵션은 [PostgreSQL pg_restore 문서](https://www.postgresql.org/docs/17/app-pgrestore.html)를 따른다.
