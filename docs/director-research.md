# 감독 편집 문법 조사 및 구현 범위

조사일: 2026-10-02 (한국 시간). 아래 링크의 본문을 실제로 읽고 정리했다. 소스 원문은 개발 환경의 `.data/research/`에 보관한다. 영화를 학습한 전용 모델을 훈련하거나 ‘감독 스타일을 마스터했다’고 주장하지 않는다. 이 기능은 감독·편집자의 작업에서 설명되는 문법을 참고한 편집 지침이다. 특정 영화 전체의 룩·서사·연기를 재현하는 프리셋은 아니다.

## 크리스토퍼 놀란

확인한 자료:

- [Cinematic style of Christopher Nolan](https://en.wikipedia.org/wiki/Cinematic_style_of_Christopher_Nolan), Narrative / Editing / Music 관련 본문.
- [Christopher Nolan](https://en.wikipedia.org/wiki/Christopher_Nolan), Filmmaking style.

관찰: 생략 편집, 인물의 주관성과 관객 정보의 조정, 여러 시간축의 교차편집이 반복된다. 《메멘토》의 역방향 서사는 인물의 기억 경험과 연관된다. 《덩케르크》의 서로 다른 시간 범위와 셰퍼드 톤은 지속되는 긴장감을 구축한다. 따라서 ‘아무 순서로나 뒤집기’나 ‘어둡게 색보정하기’가 놀란 편집의 대체가 되지 않는다.

앱 적용: 로컬 모드는 뒤로 갈수록 컷 길이를 줄이는 리듬 해석을 사용한다. Codex에는 평행 행동·명확한 시간축·시점의 근거를 먼저 찾고, 근거가 없으면 원래 순서를 유지하도록 지시한다. 대사를 임의 절단하거나 자동으로 의미를 반전시키지 않는다. 셰퍼드 톤 생성·다중 시간축 인식은 구현 완료 기능으로 표시하지 않는다.

## 스티븐 스필버그

확인한 자료:

- [StudioBinder: Steven Spielberg Movies — Filmmaking Style & Techniques](https://www.studiobinder.com/blog/steven-spielberg-movies-filmmaking-style/), oners, Spielberg face, Point of Thought 설명.
- [StudioBinder: The Kuleshov Effect Explained](https://www.studiobinder.com/blog/kuleshov-effect-examples/).
- [Steven Spielberg](https://en.wikipedia.org/wiki/Steven_Spielberg), Method and themes, Collaborators.

관찰: 한 쇼트 안에서 인물 동선과 카메라로 여러 구도를 이어가므로 불필요한 컷을 줄일 수 있다. 인물의 감정적 반응을 먼저 보여주고 그가 바라보는 대상으로 이어지는 ‘Spielberg face’는 관객의 감정을 안내한다. 편집은 Michael Kahn 등 편집자와의 협업 결과라는 점도 중요하다.

앱 적용: 연속 동작·반응 장면을 보존하는 여유 있는 컷 길이를 선호한다. Codex는 얼굴 반응과 대상의 시선 관계가 대표 프레임에서 확인될 때만 연결 순서를 제안한다. 얼굴이나 감정을 프레임 하나로 확정하지 않으며, 원본에 없는 반응을 생성하지 않는다.

## 봉준호

확인한 자료:

- [Bong Joon-ho](https://en.wikipedia.org/wiki/Bong_Joon-ho), Filmmaking style의 장르 혼합·블랙코미디·톤 전환과 2017 TIFF 발언.
- [StudioBinder: Set Dressing Guide — How Bong Joon-ho’s Parasite Creates Meaning](https://www.studiobinder.com/blog/set-dressing-definition/), 공간의 구성과 행동이 인물·계층 정보를 드러내는 분석.

관찰: 감정·장르의 급격한 전환과 구체적 공간 정보가 중요하다. 자료의 TIFF 발언에서 감독은 전환 시점을 기계적으로 공식화하지 않는다고 설명한다. 따라서 ‘몇 초마다 반전’이라는 규칙을 그의 실제 방법이라고 주장할 수 없다. 공간 미술에 관한 자료는 편집의 직접 규칙이 아니라 공간 관계를 훼손하지 않아야 한다는 판단의 근거다.

앱 적용: 로컬에서 길고 짧은 컷의 대비를 실험적으로 적용한다. Codex에는 원인→행동→결과, 출입 동선, 관객이 먼저 알아야 할 정보를 보존하도록 지시한다. 농담이나 위협을 영상에 없는데 만들어내지 않는다. 원본 내용에 대한 신뢰할 만한 증거가 있어야 톤 전환을 제안한다.

## 웨스 앤더슨

확인한 자료:

- [StudioBinder: Wes Anderson Symmetry & Symmetrical Editing Explained](https://www.studiobinder.com/blog/wes-anderson-symmetry/), shot/reverse shot, pattern events, metric montage 본문.
- [Wes Anderson](https://en.wikipedia.org/wiki/Wes_Anderson), Visual style / Soundtracks.

관찰: 대칭은 화면 중앙 구도에 한정되지 않고 쇼트 사이 인물 배치·행동·타이밍의 대응으로 확장된다. 정면 중앙 구도의 쇼트/리버스 쇼트, 반복되는 행동, 일정 프레임 수로 맞추는 메트릭 몽타주가 설명된다. 한 가지 파스텔 필터나 임의 대칭 크롭은 이 편집 문법의 대체가 아니다.

앱 적용: 음성 없는 클립의 목표 길이를 균등 배분하고 24fps 출력으로 리듬을 만든다. Codex에는 중앙 정렬·유사 구도·반복 행동을 연결 후보로 찾도록 지시한다. 원본 구도를 임의로 바꾸지 않는다. 음악의 박자 분석에 맞춘 자동 컷이나 복잡한 크롭 추적은 아직 제공하지 않는다.

## 공통 실행 규칙

- 프리셋의 수치 가중치는 제품의 설계 값이다. 감독 영화의 실제 평균 쇼트 길이를 측정한 통계가 아니다.
- 감독 선택만으로 색감을 일괄 덮어쓰지 않는다. 색보정은 사용자가 클립 속성에서 조절한다.
- 로컬 FFmpeg 편집은 장면의 의미를 이해하지 않는다. 무음과 구간 길이 규칙을 수행한다.
- Codex는 최대 18개 클립의 대표 프레임과 무음 분석을 입력받는다. 전체 영상을 감상하거나 대사를 전부 이해했다고 가정하지 않는다.
- 생성이 필요한 개선안은 비용과 전송 자료를 포함한 별도 보고서로 제시한다. 서버가 명시적 승인을 확인해야 생성 요청을 보낸다.
- 실제 API 인증과 생성 제공업체가 없는 환경에서 그 외부 서비스를 검증 완료라고 표시하지 않는다.
