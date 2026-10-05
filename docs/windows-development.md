# Windows 개발 환경

2026-10-05 한국 시간, 실제 Windows 11 Pro PC의 `D:\video-edit`에서 `soylab-edu/video-edit`의 `codex/moa-studio-local` (`022ee43`)를 복제한 후 검증했습니다. Docker는 설치하지 않았습니다. 최종 사용자용 Windows 설치 파일은 별도 후속 작업입니다.

## 설치와 실행

Git, Node.js 24+, 기본 Python, FFmpeg/FFprobe 7+를 PATH에서 찾을 수 있어야 합니다. 설치 스크립트는 npm 잠금 의존성, uv 0.12.23, Python 3.12 가상 환경, CPU PyTorch와 오디오 패키지, 고정 버전 BandIt 소스/공식 모델, 테스트 Chromium과 프런트엔드 빌드를 준비합니다. 모델은 약 446 MB이며 공식 체크섬을 확인합니다. Windows 자막은 `%WINDIR%\Fonts\malgunbd.ttf`를 사용합니다. 다른 폰트는 `MOA_FONT`로 지정합니다.

```powershell
cd D:\video-edit
./scripts/setup-windows.ps1
npm.cmd run dev:local
```

또는 `start-moa.cmd`를 실행합니다. 브라우저에서 `http://127.0.0.1:5173`을 엽니다. API는 `127.0.0.1:3001`에 바인딩됩니다. 실행 창의 Ctrl+C로 편집기와 API를 종료합니다. 동일 편집기가 실행 중이면 다시 시작하지 않고 기존 주소를 안내합니다. 프런트엔드는 Vite 자동 갱신을 사용하며 API 코드를 바꾼 뒤에는 실행기를 다시 시작합니다.

실행기는 개발 모드의 로컬 전용 환경입니다. 인터넷 공개용 실행기로 사용하지 마세요. 프로덕션 비밀번호 인증은 기존 `npm start`/운영 설정에 유지되어 있습니다.

개발 작업실은 `.data/windows-workspace`에 저장됩니다. `.data/vendor`와 `.data/models`에는 공용 런타임/모델이 있으며 `.data/live-workspace`의 클라우드 자료는 건드리지 않습니다. 실행기 사용 시 `MOA_DATA_DIR`로 작업실 경로를 지정할 수 있습니다. 프로젝트 JSON은 미디어를 포함하지 않으므로 보관함 원본과 함께 유지해야 합니다. `.data`, `.venv`, `node_modules`, 인증 자료와 테스트 결과는 Git에 넣지 않습니다.

## 실제 검증

확인한 런타임은 Node 24.18.0, Python 3.12.15, FFmpeg Windows GPL 빌드 `N-125444-g6d72600a30-20260703`, uv 0.12.23, CPU PyTorch 2.5.1입니다.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:windows
```

`test:windows`는 임시 작업실/서버와 합성 영상만 사용합니다. 한글·공백·작은따옴표가 포함된 경로에서 업로드, 재생, 트림, 분할, 실행 취소/복원, 한글 자막, JSON 다운로드와 다시 열기, 새로고침 복원, localStorage 삭제 후 서버 복원, MP4 다운로드를 검사합니다. FFprobe로 H.264/AAC·1280×720·24fps·3초를 확인하고 전체 프레임을 디코딩합니다. 사용자 로그인이나 유료 제공업체를 호출하지 않습니다.

기존 브라우저 검사는 별도 작업실로 실행합니다. 새 PowerShell 창에서 다음 서버를 실행한 뒤 다른 창에서 검사합니다. 이 폴더는 테스트 전용이어야 합니다.

```powershell
$env:PORT='3011'
$env:NODE_ENV='development'
$env:MOA_DATA_DIR='D:\video-edit\test-results\browser-workspace'
node server/index.mjs
```

```powershell
$env:MOA_TEST_URL='http://127.0.0.1:3011'
npm.cmd run test:browser
node scripts/validate-local-audio.mjs
```

마지막 오디오 명령은 합성 검증 문장을 Microsoft Edge TTS에 전송하는 명시적 검사입니다. 별도 API 키/유료 생성 제공업체를 사용하지 않으며, 음성을 보관함에 추가한 뒤 합성 음악과 혼합한 3초 오디오를 로컬 BandIt으로 분리합니다. speech/music/effects 3개를 보관함에서 다운로드하고 44.1kHz·스테레오·3초·정상 디코딩을 확인합니다. 분리 품질 벤치마크가 아닙니다.

실제 결과: 자동 검사 18개 통과, 브라우저 재생/편집/로컬 자동편집/모바일 검사 통과, Windows 전체 흐름 통과, 브라우저 런타임 오류 0, TTS/BandIt API 통과. `test-results/windows-workflow.json`과 `windows-audio.json`에 상세 결과가 있으며 `windows-edited.mp4`, `windows-export.png`, `windows-export-frame.png`에 결과를 남깁니다.

## 수정한 Windows 오류

- Linux 전용 Python·폰트 경로를 플랫폼별로 선택합니다.
- FFmpeg 자막 필터는 작업 디렉터리의 상대 파일명을 사용해 드라이브 문자/백슬래시/한글/작은따옴표 충돌을 피합니다.
- 분할 후 출력은 24fps 고정 프레임레이트로 다시 인코딩합니다.
- 미디어 추가 버튼과 삭제 버튼이 겹치던 위치를 분리했습니다.
- Windows Codex 0.160.0 실행 파일과 필수 환경 변수를 지원합니다. 테스트용 JS 실행 파일은 Node를 통해 실행합니다.
- Chromium 검사는 Playwright 설치본을 사용합니다. sharp를 0.35.5로 갱신한 뒤 npm audit은 취약점 0개입니다.

## 연결 및 검증 범위

사용자가 편집기에서 실제 ChatGPT 기기 인증을 승인했고, 서버 재시작과 브라우저 새로고침 후 연결이 유지됐습니다. 호스트 로그인 토큰을 복사하지 않았습니다. Runway 계정·H3 모델 조회와 승인 후 실제 생성·편집기 가져오기까지 성공했습니다. PixVerse는 공식 로컬 CLI의 설치·인증을 확인해 표시하지만 편집기 생성 실행 어댑터는 미구현입니다. HeyGen은 MCP 실행 경로에서 재인증을 요청했습니다. Docker 빌드, 설치형 .exe와 자동 업데이트는 아직 검증하지 않았습니다.

### 파일 전송 오류 수정

Runway가 파일 메타데이터만 받는 초기화를 거절했고, 로컬 경로 문자열도 원격 파일 객체로 변환되지 않는 것을 실제 오류로 확인했습니다. 직접 mcpServer/tool/call에는 Codex의 파일 인자 변환이 적용되지 않으므로 공식 Codex 0.160.0의 파일 전송 계약에 따라 작업실 계정으로 파일 등록 → 승인된 바이트 PUT → 등록 완료 확인을 구현했습니다. 실제 file_id/download_url 객체를 Runway에 전달하고 직접 upload_complete 또는 multipart 완료 응답을 처리합니다. 인증 헤더는 고정된 OpenAI API에만 전송하며 저장소 PUT에 전달하지 않습니다. 내부 주소와 리다이렉트를 거절하고, 실패한 바이트 전송이나 생성 요청을 자동 재실행하지 않습니다.

### 승인 화면 간소화 및 만료 복구

화면은 작업 한 줄·플러그인 예상 크레딧·‘승인하고 실행’ 버튼으로 줄였습니다. 전체 보고서·전송 프레임·정확한 설정·작업 기록은 접힌 상세 화면에 있습니다. 10분 만료 시 이유와 ‘확인 내용 갱신’을 표시합니다. 갱신은 동일한 작업·소재·인자를 보존한 새 확인 ID만 발급하며 승인이나 외부 실행을 하지 않습니다. 기존 ID는 다시 실행할 수 없습니다.

Codex가 보고서 제출 후 턴을 끝내도 승인 대기를 유지하고, 승인 후 정확한 미사용 호출만 새 격리 실행기로 재개합니다. 미실행 보고서만 서버 재시작 후 만료된 상태로 복구하며 이미 승인/실행한 작업은 자동 재개하지 않습니다. 만료·소유권·동시 승인·중복 실행 차단을 자동 검사했고 실제 단일 승인 버튼도 확인했습니다. 화면 증거는 test-results/approval-simple.jpg입니다.

### 실제 Runway H3 생성부터 내보내기까지 완료

사용자가 H3 5초 작업을 승인하고 부재중 필요한 승인도 위임한 뒤, 동일한 소재와 조건으로 실제 작업을 완료했습니다. 앞선 실패는 파일 전송/생성 전에 중단됐으며, 성공 작업에서는 선택한 마지막 프레임 업로드 1회와 H3 생성 1회만 실행했습니다.

- 원본은 `03 · 새로운 풍경`의 트림된 끝에서 한 프레임 앞인 5.958333초의 1280×720 JPEG입니다. 실제 이미지 바이트를 등록한 뒤 Runway의 `startFrame`에 사용했습니다. 생성 첫 프레임에서도 산·침엽수·도로·흰 자동차 구도를 확인했습니다.
- Moa 작업 `fa8e772c-ecd2-4b47-919f-a81e7b0d0d5a`, Runway 작업 `91e45d86-36a1-47be-b6f4-bba3130177ab`가 완료됐습니다. 요청은 `hailuo-3`, 5초, 720p, 16:9, 영상 1개입니다. 실제 결과는 H.264/AAC·1344×768·24fps·5.166667초였습니다.
- 도구 응답의 입력 이미지 재반환과 포스터를 영상 결과로 잘못 표시하던 수집 로직도 수정했습니다. UI에 실제 결과 영상 1개가 표시됐고, ‘미디어로 가져오기’로 보관함에 추가했습니다.
- 실제 편집기에서 타임라인에 추가하고 끝 시간을 5초로 조정했습니다. 원래 22초 프로젝트는 총 27초·4개 클립이 됐습니다. 생성 구간 재생에 오류가 없었고 새로고침 후 프로젝트와 5초 트림이 복원됐습니다.
- 실제 UI 내보내기 및 다운로드 결과는 H.264/AAC·1280×720·24fps·27.000초, 648프레임, 1,508,880바이트입니다. FFprobe 검사와 전체 파일 디코딩에 오류가 없었습니다.
- 조회한 Runway 잔액은 생성 전 2,791에서 완료 후 2,739로 52크레딧 감소했습니다. 이는 조회 잔액의 차이이며 제공업체가 반환한 개별 작업 청구 명세는 아닙니다.
- 최종 자동 검사 30개 통과(실패·스킵 0), TypeScript/프로덕션 빌드 통과. 파일 전송 계약, 인증 헤더 분리, 내부 주소/리다이렉트 차단, 취소, 중복 실행 차단, 입력/포스터 제외를 포함합니다.

산출물: `test-results/runway-h3-original.mp4`(생성 원본), `runway-h3-edited-27s.mp4`(실제 다운로드한 편집본), `runway-h3-project.json`(서버 저장 프로젝트 사본), `runway-h3-validation.json`(검증 요약), `runway-h3-export-complete.jpg`(실제 완료 화면). 프로젝트 JSON은 미디어를 포함하지 않습니다. 이 후속 작업의 브라우저 프로젝트 JSON 다운로드 이벤트는 확인되지 않았으므로 서버 저장/새로고침 복원 및 저장 파일 사본과 구분합니다.
