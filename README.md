# 역사 타임라인 탐색기 (Backend + Frontend)

이 저장소는 Turso(libsql) 기반의 역사 관련 팟캐스트 전사 DB를 기반으로,
시간 순으로 사건/발언 타임라인을 만들고 각 에피소드의 상세 발언을 확인할 수 있게 구성한 예시입니다.

구성:
- backend: Cloudflare Worker API (`backend/src/index.js`)
- frontend: React(Vite) SPA (`frontend/src/App.jsx`)
- 배포: Cloudflare Workers + Pages, GitHub Actions 자동 배포

## 파일 구조
- `/backend`
  - `wrangler.toml`: Worker 배포 설정, 기본 환경변수
  - `src/index.js`: API 라우트
  - `package.json`: backend 스크립트
  - `.dev.vars.example`: 로컬 실행용 예시
- `/frontend`
  - `index.html`, `vite.config.js`, `src/main.jsx`, `src/App.jsx`, `src/App.css`
  - `.env.example`: VITE_API_BASE 예시
- `/.github/workflows/deploy-cloudflare.yml`: 배포 파이프라인

## API 설계(요청 충족 포인트)
- 시간순 사건/발언 목록: `GET /api/facts`
- 에피소드 인덱스: `GET /api/episodes`
- 개별 에피소드 상세 발언: `GET /api/episode/:id`
- 상태 확인: `GET /api/health`

`/api/facts`는 아래 조건을 조합해서 결과를 반환합니다.
- `keyword`: segment 텍스트 키워드 검색
- `from`, `to`: 에피소드 날짜 범위
- `sort`: `asc|desc` (기본 `asc`, 오래된 날짜순)
- `limit`, `offset`: 페이지네이션

`/api/episode/:id`는 해당 에피소드의 세그먼트(발언) 전체를 반환해 상세 확인 화면을 구성합니다.

## 로컬 실행 (터미널)

1) 백엔드 실행
```
cd /Volumes/P31/app-22j/backend
cp .dev.vars.example .dev.vars   # 필요 시 값 채움(필요 시 덮어씀)
npm ci
npm run dev
```

2) 프론트 실행
```
cd /Volumes/P31/app-22j/frontend
cp .env.example .env             # VITE_API_BASE 확인
npm ci
npm run dev
```

프론트 기본은 `http://localhost:5173`, API는 Worker dev 기본 포트(보통 8787)에서 동작 가정.

## 배포: Cloudflare + GitHub Actions
워크플로우: `.github/workflows/deploy-cloudflare.yml`

사전 설정(Repo Settings)
- Secrets:
  - `CF_API_TOKEN`
  - `CF_ACCOUNT_ID`
- Vars:
  - `CF_PAGES_PROJECT`
  - `DEPLOY_API_BASE` (선택: Worker 실제 배포 URL, 예: https://history-timeline-api.your-subdomain.workers.dev)
- Backend 설정:
  - `TIMELINE_DB_TOKEN`(Secrets): GitHub Actions에서 `wrangler secret put`로 Worker secret 동기화 (없으면 배포 전에 Cloudflare 대시보드에서 수동 등록)
  - `TIMELINE_DB_URL`(선택): 기본값은 `backend/wrangler.toml`의 `[vars]` 사용, 로컬/임시 재배포 시 `.dev.vars` 또는 `--define/var`로 오버라이드

수동 실행
- GitHub에서 해당 브랜치에 push하거나 `workflow_dispatch`로 실행

## 검증 체크리스트
- `npm run build` (backend, frontend) 통과
- 정렬 토글(오래된 날짜순/최신 날짜순)이 동작하는지 확인
- (선택) CI 배포 후 스모크 검증: `vars.DEPLOY_API_BASE/api/health`
- (선택) CI 배포 후 스모크 검증: `vars.DEPLOY_API_BASE/api/episodes?limit=1&sort=asc`
- (선택) CI 배포 후 스모크 검증: `vars.DEPLOY_API_BASE/api/facts?limit=1&sort=asc`
- (선택) CI 배포 후 스모크 검증: `https://<CF_PAGES_PROJECT>.pages.dev`
- 프론트에서 키워드/기간 검색 후 타임라인 렌더링 확인
- 타임라인 카드에서 "해당 에피소드 상세 보기" 클릭 시 상세 발화 섹션 표시
