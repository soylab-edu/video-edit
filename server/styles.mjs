// Editorial interpretations, not a claim that a preset reproduces a director's work.
// Sources were read on 2026-10-02. Numerical pacing is a product heuristic, not a measured director fingerprint.
export const styles = [
  {
    id: "none",
    name: "스타일 없이 맡기기",
    english: "Your story, your rhythm",
    color: "#a2e4cd",
    description: "내용과 원래 흐름을 우선하는 담백한 편집",
    principles: [
      "원래 장면 순서 유지",
      "대사 중간 절단 방지",
      "과한 효과 없이 무음과 음량 정리",
    ],
    pace: [1, 1, 1],
    saturation: 1,
    brightness: 0,
    research: "기본 편집 규칙",
    sources: [],
  },
  {
    id: "nolan",
    name: "크리스토퍼 놀란",
    english: "Tension & momentum",
    color: "#8faccc",
    description: "점점 촘촘해지는 리듬과 긴장감",
    principles: [
      "후반 긴장감을 위한 점진적 컷 압축",
      "서로 다른 시간축 교차편집은 맥락 확인 후 제안",
      "사운드의 연속성과 명확한 시간 정보 유지",
    ],
    pace: [1.35, 1, 0.65],
    saturation: 1,
    brightness: 0,
    research: "자료 확인 · 2026.10.02 · 앱의 편집 해석",
    sources: [
      {
        title: "Christopher Nolan — style and filmmaking",
        url: "https://en.wikipedia.org/wiki/Christopher_Nolan",
        verified: true,
      },
      {
        title: "Cinematic style of Christopher Nolan · narrative / editing",
        url: "https://en.wikipedia.org/wiki/Cinematic_style_of_Christopher_Nolan",
        verified: true,
      },
    ],
  },
  {
    id: "spielberg",
    name: "스티븐 스필버그",
    english: "Emotion & discovery",
    color: "#dec694",
    description: "인물의 감정과 발견의 순간에 여유를 주는 흐름",
    principles: [
      "연속된 동작·카메라 이동은 불필요하게 자르지 않기",
      "인물의 반응 → 바라보는 대상의 순서로 감정 전달",
      "대사가 있는 컷의 연결을 우선",
    ],
    pace: [1.1, 1.15, 1.3],
    saturation: 1,
    brightness: 0,
    research: "자료 확인 · 2026.10.02 · 앱의 편집 해석",
    sources: [
      {
        title: "Steven Spielberg — filmmaking style",
        url: "https://en.wikipedia.org/wiki/Steven_Spielberg",
        verified: true,
      },
      {
        title: "StudioBinder · Spielberg face, oners and Point of Thought",
        url: "https://www.studiobinder.com/blog/steven-spielberg-movies-filmmaking-style/",
        verified: true,
      },
    ],
  },
  {
    id: "bong",
    name: "봉준호",
    english: "Contrast & control",
    color: "#c0c49a",
    description: "정돈된 리듬 속에 대비와 멈춤을 만드는 편집",
    principles: [
      "원인·행동·결과의 정보를 보존하며 리듬 대비",
      "공간 관계와 인과관계를 유지",
      "블랙코미디와 긴장 전환은 실제 장면 근거가 있을 때만",
    ],
    pace: [1.35, 0.7, 1.15, 0.8],
    saturation: 1,
    brightness: 0,
    research: "자료 확인 · 2026.10.02 · 앱의 편집 해석",
    sources: [
      {
        title: "Bong Joon-ho — career and filmmaking",
        url: "https://en.wikipedia.org/wiki/Bong_Joon-ho",
        verified: true,
      },
      {
        title: "StudioBinder · Parasite and spatial storytelling",
        url: "https://www.studiobinder.com/blog/set-dressing-definition/",
        verified: true,
      },
    ],
  },
  {
    id: "wes",
    name: "웨스 앤더슨",
    english: "Rhythm & order",
    color: "#dbb6a2",
    description: "일정한 박자와 챕터 중심의 정갈한 구성",
    principles: [
      "일정한 프레임 길이의 메트릭 몽타주",
      "중앙 인물·유사 구도·반복 행동을 연결 후보로 제안",
      "대칭 효과를 위해 없는 구도를 크롭으로 만들지 않기",
    ],
    pace: [1, 1, 1],
    saturation: 1,
    brightness: 0,
    research: "자료 확인 · 2026.10.02 · 앱의 편집 해석",
    sources: [
      {
        title: "Wes Anderson — themes and style",
        url: "https://en.wikipedia.org/wiki/Wes_Anderson",
        verified: true,
      },
      {
        title: "StudioBinder · Wes Anderson Symmetry & Symmetrical Editing",
        url: "https://www.studiobinder.com/blog/wes-anderson-symmetry/",
        verified: true,
      },
    ],
  },
];
