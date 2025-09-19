# GitHub 커밋 요약/피드백 웹앱

Express + Vanilla JS로 만든 깃허브 커밋 뷰어/AI 분석기.
- 리포 URL 입력 → 브랜치 선택 → 커밋 목록(페이지네이션 10개/페이지)
- 커밋 카드 클릭 → 상세 모달(파일 변경/코드 디프)
- 모달에서 Gemini로 요약/피드백 분석

## 데모(로컬)
- 서버: http://localhost:3000
- 프런트: 같은 서버에서 `public/` 정적 서빙

## 요구사항
- Node.js 18+
- GitHub API 접근(공개 저장소면 토큰 없이도 가능)
- Google Gemini API 키

## 설치
```bash
git clone <your-fork-url>
cd express-axios-app
npm install
```

## 환경변수(.env)
```env
PORT=3000
# 공개 저장소면 GITHUB_TOKEN 없이도 동작하지만, 레이트 리밋 완화 위해 권장
GITHUB_TOKEN=ghp_xxx

# 필수: Google Gemini API 키
GEMINI_API_KEY=AIzaSyXXXX...
```

## 실행
```bash
npm start
# Server listening on http://localhost:3000
```

## 사용 방법
1. 브라우저에서 http://localhost:3000 접속
2. GitHub 리포지토리 URL 입력 (예: https://github.com/vercel/next.js)
3. 브랜치 선택(옵션) → 커밋 불러오기
4. 커밋 카드 클릭 → 상세 모달
5. 모달에서 분석 모드(요약/피드백) 선택 → “이 커밋 분석하기”

## 주요 기능
- 브랜치 선택: `/api/branches`
- 커밋 목록(페이지네이션): `/api/commits?repoUrl=...&per_page=10&page=1&branch=...`
- 커밋 상세(파일 변경/코드 디프): `/api/commit-detail?repoUrl=...&sha=...`
- AI 분석(요약/피드백):
  - 메인 페이지: 버튼 제거(상세 모달 전용)
  - 모달에서 단일 커밋 분석(실제 코드 디프 기반)

