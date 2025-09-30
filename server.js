import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 페이지 제공
app.use(express.static('public'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/github', async (req, res) => {
  try {
    const response = await axios.get('https://api.github.com');
    res.json({ data: response.data });
  } catch (error) {
    const status = error.response?.status || 500;
    res.status(status).json({ message: 'External request failed', status });
  }
});

// 유틸: GitHub repo URL에서 owner/repo 추출
function parseRepoUrl(repoUrl) {
  if (!repoUrl) return null;
  try {
    const url = new URL(repoUrl);
    // 지원 예시: https://github.com/{owner}/{repo}(.git)?(/...)?
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    return { owner, repo };
  } catch (e) {
    return null;
  }
}

// GitHub 브랜치 목록 조회 API
// GET /api/branches?repoUrl=<github_repo_url>
app.get('/api/branches', async (req, res) => {
  const { repoUrl } = req.query;
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ message: '유효한 GitHub 리포지토리 URL을 제공하세요.' });
  }
  const { owner, repo } = parsed;

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'express-axios-app'
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const branchesApi = `https://api.github.com/repos/${owner}/${repo}/branches`;
    const response = await axios.get(branchesApi, { headers });

    const branches = (response.data || []).map(b => ({
      name: b.name,
      sha: b.commit.sha,
      protected: b.protected || false
    }));

    res.json({ owner, repo, branches });
  } catch (error) {
    const status = error.response?.status || 500;
    res.status(status).json({ message: 'GitHub 브랜치 조회 실패', status, detail: error.response?.data || error.message });
  }
});

// GitHub 커밋 상세 조회 API
// GET /api/commit-detail?repoUrl=<github_repo_url>&sha=<commit_sha>
app.get('/api/commit-detail', async (req, res) => {
  const { repoUrl, sha } = req.query;
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed || !sha) {
    return res.status(400).json({ message: '유효한 GitHub 리포지토리 URL과 커밋 SHA를 제공하세요.' });
  }
  const { owner, repo } = parsed;

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'express-axios-app'
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const commitApi = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
    const response = await axios.get(commitApi, { headers });

    const commit = response.data;
    const commitDetail = {
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date,
        login: commit.author?.login,
        avatar: commit.author?.avatar_url
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date
      },
      stats: commit.stats,
      files: commit.files?.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        blob_url: f.blob_url,
        raw_url: f.raw_url,
        contents_url: f.contents_url
      })) || [],
      url: commit.html_url
    };

    res.json({ owner, repo, commit: commitDetail });
  } catch (error) {
    const status = error.response?.status || 500;
    res.status(status).json({ message: 'GitHub 커밋 상세 조회 실패', status, detail: error.response?.data || error.message });
  }
});

// GitHub 커밋 조회 API
// GET /api/commits?repoUrl=<github_repo_url>&per_page=10&page=1&branch=<branch_name>
app.get('/api/commits', async (req, res) => {
  const { repoUrl, per_page = 10, page = 1, branch } = req.query;
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ message: '유효한 GitHub 리포지토리 URL을 제공하세요.' });
  }
  const { owner, repo } = parsed;

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'express-axios-app'
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const perPageNum = Math.min(Number(per_page) || 10, 100);
    const currentPage = Number(page) || 1;

    // 1. 먼저 전체 커밋 수 조회 (HEAD 요청으로)
    const commitsApi = `https://api.github.com/repos/${owner}/${repo}/commits`;
    const headParams = { per_page: perPageNum, page: 1 };
    if (branch) headParams.sha = branch;
    
    const headResponse = await axios.head(commitsApi, { 
      headers, 
      params: headParams 
    });
    
    // Link 헤더에서 마지막 페이지 번호 추출
    let totalPages = 1;
    const linkHeader = headResponse.headers.link;
    if (linkHeader) {
      const lastPageMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
      if (lastPageMatch) {
        totalPages = parseInt(lastPageMatch[1]);
      }
    }

    // 2. 실제 커밋 데이터 조회
    const getParams = { per_page: perPageNum, page: currentPage };
    if (branch) getParams.sha = branch;
    
    const response = await axios.get(commitsApi, {
      headers,
      params: getParams
    });

    const commits = (response.data || []).map(c => ({
      sha: c.sha,
      authorName: c.commit?.author?.name || c.author?.login || 'unknown',
      authorEmail: c.commit?.author?.email || null,
      date: c.commit?.author?.date || null,
      message: c.commit?.message || '',
      url: c.html_url
    }));

    res.json({ 
      owner, 
      repo, 
      commits,
      pagination: {
        currentPage,
        perPage: perPageNum,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1
      }
    });
  } catch (error) {
    const status = error.response?.status || 500;
    res.status(status).json({ message: 'GitHub 커밋 조회 실패', status, detail: error.response?.data || error.message });
  }
});

// Gemini 요약/피드백 API
// POST /api/commit-analysis { commits: Commit[], mode: 'summary' | 'feedback' }
app.post('/api/commit-analysis', async (req, res) => {
  const { commits, mode = 'summary', singleCommit = false } = req.body || {};
  if (!Array.isArray(commits) || commits.length === 0) {
    return res.status(400).json({ message: '분석할 커밋 배열(commits)이 필요합니다.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ message: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { apiVersion: 'v1beta' });
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    

    let commitList;
    let instructions;

    if (singleCommit && commits.length === 1) {
      // 단일 커밋 분석 - 실제 커밋 상세 정보 가져오기
      const commitSha = commits[0].sha;
      const repoUrl = req.body.repoUrl;
      
      if (!repoUrl) {
        return res.status(400).json({ message: '리포지토리 URL이 필요합니다.' });
      }
      
      const parsed = parseRepoUrl(repoUrl);
      if (!parsed) {
        return res.status(400).json({ message: '유효한 GitHub 리포지토리 URL을 제공하세요.' });
      }
      const { owner, repo } = parsed;

      // GitHub API에서 커밋 상세 정보 가져오기
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'express-axios-app'
      };
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const commitApi = `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}`;
      const commitResponse = await axios.get(commitApi, { headers });
      const commitData = commitResponse.data;

      // 파일별 변경사항 요약 생성 (더 상세한 코드 디프 포함) + 안전한 길이 제한
      let fileChanges = '';
      if (commitData.files && commitData.files.length > 0) {
        fileChanges = '\n\n변경된 파일들과 코드 변경사항:\n';
        const MAX_PROMPT_CHARS = 8000; // 전체 프롬프트 안전 상한
        const MAX_FILES = 20; // 너무 많은 파일 시 잘라냄
        const files = commitData.files.slice(0, MAX_FILES);

        for (const file of files) {
          // 파일 헤더 추가
          let nextChunk = `\n파일: ${file.filename} (${file.status}): +${file.additions} -${file.deletions}\n`;
          if ((fileChanges + nextChunk).length > MAX_PROMPT_CHARS) break;
          fileChanges += nextChunk;

          if (file.patch) {
            const patchLines = file.patch.split('\n');
            let codeChanges = '';
            let emitted = 0;
            const MAX_DIFF_LINES = 80; // 파일당 최대 라인 수

            for (let i = 0; i < patchLines.length && emitted < MAX_DIFF_LINES; i++) {
              const line = patchLines[i];
              if (line.startsWith('@@')) {
                codeChanges += `\n[변경 영역] ${line}\n`;
              } else if (line.startsWith('+')) {
                codeChanges += `+ ${line.substring(1)}\n`;
                emitted++;
              } else if (line.startsWith('-')) {
                codeChanges += `- ${line.substring(1)}\n`;
                emitted++;
              } else if (line.startsWith(' ') || line.startsWith('\\')) {
                // 컨텍스트 라인은 간략히
                if (emitted < MAX_DIFF_LINES) {
                  codeChanges += `  ${line.replace(/^ /, '')}\n`;
                  emitted++;
                }
              }
              if ((fileChanges + codeChanges).length > MAX_PROMPT_CHARS) break;
            }

            if (codeChanges.trim()) {
              nextChunk = `코드 변경사항:\n${codeChanges}\n`;
              if ((fileChanges + nextChunk).length > MAX_PROMPT_CHARS) break;
              fileChanges += nextChunk;
            }
          }

          if (fileChanges.length > MAX_PROMPT_CHARS) break;
        }

        // 너무 길어 잘린 경우 표시
        if ((commitData.files.length > MAX_FILES) || fileChanges.length > MAX_PROMPT_CHARS) {
          fileChanges += '\n(일부 파일/라인은 길이 제한으로 생략되었습니다)\n';
        }
      }

      commitList = `커밋: ${commitData.sha?.slice(0,7) || ''}
작성자: ${commitData.commit?.author?.name || commitData.author?.login || 'Unknown'}
날짜: ${commitData.commit?.author?.date || ''}
메시지: ${commitData.commit?.message?.replace(/\s+/g,' ').trim() || ''}
변경된 파일: ${commitData.files?.length || 0}개
추가: ${commitData.stats?.additions || 0}줄, 삭제: ${commitData.stats?.deletions || 0}줄${fileChanges}`;

      instructions = mode === 'feedback'
        ? `다음 단일 커밋의 메시지와 실제 코드 변경사항(diff)을 분석하여 개선 피드백을 한국어로 제공해 주세요. 반드시 번호 매긴 리스트(1., 2., ...) 형식으로 답변하고, 다음 관점에서 분석하세요: 1) 커밋 메시지가 실제 코드 변경사항을 정확히 반영하는지, 2) 코드 변경사항의 적절성과 품질, 3) 추가/삭제된 코드의 의미와 영향, 4) 개선 제안사항. 마크업(*, -, # 등)과 코드블록은 사용하지 마세요.`
        : `다음 단일 커밋의 실제 코드 변경사항(diff)을 상세히 분석하여 요약을 한국어로 제공해 주세요. 반드시 번호 매긴 리스트(1., 2., ...) 형식으로 답변하고, 다음 내용을 포함하세요: 1) 각 파일별 주요 변경사항 (추가/삭제/수정된 코드의 기능), 2) 변경된 함수나 클래스의 역할, 3) 새로운 기능 추가나 버그 수정 여부, 4) 코드 변경의 영향도와 중요성, 5) 기술적 세부사항. 실제 코드 내용을 바탕으로 구체적으로 분석하세요. 마크업(*, -, # 등)과 코드블록은 사용하지 말고, 워드 문서처럼 평문으로 작성하세요. 추가적인 소제목이나 마크업 기호(**, *, -, # 등)는 절대로 사용하지 말고, 번호와 문장만 작성하세요.`;
    } else {
      // 다중 커밋 분석 (기존 로직)
      commitList = commits
        .slice(0, 200) // 과도한 토큰 방지
        .map(c => `- ${c.sha?.slice(0,7) || ''} ${c.date || ''} ${c.authorName || ''}: ${c.message?.replace(/\s+/g,' ').trim()}`)
        .join('\n');

      instructions = mode === 'feedback'
        ? `다음 커밋 메시지들의 명확성, 일관성, 관례 준수(Conventional Commits 등) 관점에서 개선 피드백을 한국어로 제공해 주세요. 반드시 번호 매긴 리스트(1., 2., ...) 형식으로 답변하고, 각 항목마다 구체적 이유와 개선된 예시 메시지를 포함하세요. 마크업(*, -, # 등)과 코드블록은 사용하지 마세요.`
        : `다음 커밋 내역의 핵심 변경사항을 한국어로 간결하게 요약해 주세요. 반드시 번호 매긴 리스트(1., 2., ...) 형식으로 답변하고, 주요 기능 추가, 버그 수정, 리팩터링, 문서/빌드 변경 등으로 분류해 주세요. 마크업(*, -, # 등)과 코드블록은 사용하지 말고, 워드 문서처럼 평문으로 작성하세요. 추가적인 소제목이나 마크업 기호(**, *, -, # 등)는 절대로 사용하지 말고, 번호와 문장만 작성하세요.`;
    }

    const prompt = `${instructions}\n\n${singleCommit ? '커밋 정보:' : '커밋 목록:'}\n${commitList}`;

    // 모델 호출
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    res.json({ mode, result: text, singleCommit });
  } catch (error) {
    console.error('Gemini 분석 실패:', error?.response?.data || error?.message || error);
    const status = 500;
    res.status(status).json({ message: 'Gemini 분석 실패', status, detail: error?.response?.data || error?.message || 'Unknown error' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

