# 플러그인 게이트웨이 계약

## Codex 연결로 직접 실행

공식 SDK/CLI 0.160.0을 고정합니다. `GET /api/connections/codex-apps`는 사용자별 CODEX_HOME으로 추론 없는 thread를 만들고 `mcpServerStatus/list`에서 실제 도구를 조회합니다. Runway·Magnific·HeyGen·PixVerse만 표시하며, 조회 가능한 계정 확인 도구를 읽기 전용으로 호출해 `authentication`을 판단합니다. `executionReady=true`는 실행 경로와 계정 조회가 확인됐다는 뜻이며 모든 모델/유료 생성의 성공 보장이 아닙니다. 다른 앱과 계정 프로필은 화면에 전달하지 않습니다. 갱신은 `POST /api/connections/codex-apps/refresh`이며 사용자별 5분 캐시를 사용합니다.

`POST /api/codex-tasks`에 providerId, prompt, mode(none/f2f/refs), references(assetId/kind/time)를 전달합니다. 서버는 소유권·시간 범위를 검증합니다. 추론용 Codex thread는 apps/plugins/shell/image_generation을 비활성화하고 해당 제공업체의 허용된 동적 도구만 제공합니다. 읽기 도구는 명시적인 허용 목록과 readOnlyHint를 모두 만족해야 합니다.

생성·업로드·변경 도구는 `moa_review`로 정확한 도구/인자, 목적, 예상 크레딧, 비용 출처, 후속 필요사항을 먼저 보고합니다. `/api/codex-tasks/:id/approve`는 현재 reportId, approved=true, acknowledgeEstimatedCost=true를 요구합니다. 다른 소유자, 만료, 재승인, 인자 변경을 거절합니다. 승인 호출 권한은 전송 전에 1회 소비합니다. 실행기는 공식 `mcpServer/tool/call`로 정확한 도구만 실행하며 실패·타임아웃을 자동 재시도하지 않습니다. 모델 추정 비용을 확정 견적으로 취급하지 않습니다.

원본은 승인 후에만 `/share/:token`의 256비트 임시 접근 URL로 공유합니다. F2F는 정확한 경계 프레임을 FFmpeg로 추출합니다. 공유는 작업 완료/중단 시 폐기되고 45분 뒤 만료됩니다. `MOA_PUBLIC_URL` 또는 현재 미리보기 상태의 HTTPS 주소를 사용합니다. 외부 생성 서버가 임시 HTTPS 서버에 접근할 수 있어야 합니다. 출력 URL은 실제 도구 응답에서 수집하고 사용자 요청으로 가져옵니다. HTTPS·공개 주소·파일 크기를 검사한 뒤 FFmpeg로 미디어를 검증합니다.

작업 보고서/결과는 사용자별 파일에 보관합니다. 서버 재시작으로 중단된 작업은 interrupted로 표시하고 재실행하지 않습니다. 중단은 이미 전송한 제공업체 작업의 취소나 환불을 뜻하지 않습니다. 일반 게이트웨이 작업의 기존 메모리 큐와 구분합니다.

프로토콜 기준: [공식 Codex 0.160.0](https://github.com/openai/codex/tree/rust-v0.160.0/codex-rs/app-server). 계정 앱 목록에 없더라도 실제 도구 목록에서 Magnific 같은 연결을 찾을 수 있습니다. PixVerse처럼 실행 도구가 전달되지 않은 제공업체를 연결 완료로 표시하지 않습니다.

## 생성 게이트웨이

`PLUGIN_GATEWAY_URL`은 운영자가 지정하는 HTTPS 서버입니다. 브라우저는 임의 서버를 지정하지 않습니다. 자동 테스트에서만 `MOA_ALLOW_LOCAL_GATEWAY=1`로 loopback HTTP를 허용합니다. 모든 요청은 연결한 사용자 토큰을 `Authorization: Bearer`로 전송합니다.

## GET /v1/capabilities

```json
{"plugins":[{"id":"video-provider","name":"My video provider","description":"내 계정의 영상 도구","capabilities":["video-generation","image-generation"],"modes":["f2f","omni"]},{"id":"separator","name":"My separator","description":"3종 분리","capabilities":["audio-separation"],"stems":["voice","sfx","bgm"]}]}
```

Capability: `video-generation`, `image-generation`, `sound-effects`, `audio-separation`, `tts`. 실제 계정 권한과 모델 능력만 반환합니다.

## POST /v1/quote

`pluginId`, `capability`, `mode`, `prompt`, `duration`, `assetIds`, 소재 이름·길이를 받습니다. 원본 미디어 바이트는 받지 않습니다. 프롬프트와 메타데이터는 견적 단계에서 전송됩니다.

```json
{"id":"immutable-quote-id","cost":3.5,"currency":"credits"}
```

작업 내용과 연결된 불변 견적을 반환하며 10분 TTL 내 금액을 보장하거나 만료 오류를 반환합니다. 통화는 임의로 환산하지 않고 통화별 합계를 표시합니다.

## POST /v1/jobs

앱이 소유권·pending 상태·TTL·명시적 승인을 검증한 후 호출합니다.

```json
{"pluginId":"video-provider","capability":"video-generation","mode":"f2f","prompt":"움직임과 빛을 유지해 연결","duration":3,"quoteId":"immutable-quote-id","idempotencyKey":"unique-proposal-id","assets":[{"id":"a","name":"앞 컷 끝","mime":"image/jpeg","position":"first","data":"BASE64"},{"id":"b","name":"뒤 컷 시작","mime":"image/jpeg","position":"last","data":"BASE64"}]}
```

게이트웨이도 `idempotencyKey`로 중복 과금을 막아야 합니다. 원본 참조는 소스당 50MB입니다. 견적 조건과 다르면 거절합니다. 응답은 `{"id":"job-id","status":"running"}` 또는 바로 완료 결과입니다.

## GET /v1/jobs/:id

상태는 `running`, `completed`, `failed`입니다.

```json
{"id":"job-id","status":"completed","outputs":[{"name":"연결 장면","data":"BASE64_MEDIA_BYTES"}]}
```

음원 분리는 각 출력에 `stem`으로 `voice`, `sfx`, `bgm`을 반환합니다. 앱은 임의 URL을 내려받지 않고 반환 바이트를 FFmpeg로 검증·변환합니다. 제공업체별 지원 길이·모델·비율·가격·약관 처리는 어댑터가 담당합니다.

일괄 승인은 순차 실행하며 실패/시간 초과 시 이후 작업을 중단합니다. 시간 초과가 제공업체 취소/환불을 뜻하지 않습니다. 완료·실패·미시작 결과를 구분합니다. 현재 승인/작업 상태는 메모리에 있으므로 운영 환경에서는 영속 DB와 복구 가능한 작업 큐를 추가합니다.
