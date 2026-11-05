---
name: 청도 농가 AI 사무장
description: 농가 주문·입금·출고를 정리하고 승인하는 업무 화면. 감색 한 가지 강조색, 따뜻한 중립 바탕, 밀도 있는 목록·상세 구조.
colors:
  persimmon: "#d9621a"
  persimmon-ink: "#a9480c"
  persimmon-soft: "#fdeee3"
  leaf: "#2f5d3a"
  leaf-soft: "#e6f0e8"
  sky: "#2b4c7e"
  sky-soft: "#e4ecf5"
  warn: "#8a5300"
  warn-soft: "#fff3dc"
  danger: "#b42318"
  danger-soft: "#fdeceb"
  ai: "#3c4f9a"
  ai-soft: "#eaeefb"
  paper: "#f6f3ee"
  sidebar: "#efeae1"
  surface: "#ffffff"
  surface-2: "#f9f6f1"
  ink: "#1d221f"
  ink-2: "#4b534e"
  ink-3: "#697069"
  line: "#e2dbcf"
  line-2: "#ece7de"
typography:
  headline:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.persimmon-ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "#8f3c09"
    textColor: "{colors.surface}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  chip:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "14px 18px"
  card-selected:
    backgroundColor: "#fffbf7"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 11px"
  sidebar-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.persimmon-ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
---

# Design System: 청도 농가 AI 사무장

## Overview

사장님이 아침마다 여는 사무 도구다. 꾸밈보다 밀도와 일관성을 택하고, 익숙한 업무용 문법(사이드바 · 목록 · 상세 · 상태 칩)을 그대로 쓴다. 브랜드는 감(persimmon) 하나의 강조색과 따뜻한 종이색 중립층, 담백한 존댓말 문장에 산다. AI가 만든 모든 결과는 `AI 제안` 표시와 근거 메시지를 함께 보여 주고, 승인 전에는 아무것도 바뀌지 않는다는 사실이 화면 곳곳에 드러난다.

- 모드: Operate. 랜딩 한 화면만 Persuade이며 거기서도 과장하지 않는다.
- 안티 레퍼런스: 큰 입력창 두 개가 화면을 차지하는 폼, 카드 안의 카드, 장식용 그라데이션·글래스.

## Colors

### Primary
- **감(persimmon)** `#d9621a` — 마크와 선택 테두리. 텍스트에는 쓰지 않는다.
- **감 잉크(persimmon-ink)** `#a9480c` — 주 행동 버튼, 현재 메뉴, 링크. 흰 글자 대비 5.9:1.
- **감 연함(persimmon-soft)** `#fdeee3` — 선택된 옵션 배경, `예제 농가` 태그, 포커스 링 바깥.

### Secondary (상태 어휘)
- **잎(leaf / leaf-soft)** — 완료·연결·오늘 출고.
- **하늘(sky / sky-soft)** — 출고 예약(오늘이 아닌 발송일).
- **주의(warn / warn-soft)** — 입금·주소·확인 대기, 사람 차례(질문·승인 대기).
- **위험(danger / danger-soft)** — 재고 부족, 보류, 미입금, 지시문 감지, 실패.
- **AI(ai / ai-soft)** — AI 제안·AI 해석·AI 작성 표시, 처리 중 상태. 사람·코드와 구분하는 유일한 용도.

### Neutral
- **종이(paper)** `#f6f3ee` 본문 바탕 → **사이드바** `#efeae1` 한 단계 어두운 중립층 → **surface** 흰색 카드 → **surface-2** `#f9f6f1` 카드 안 채움(원문 말풍선, 입력창).
- 글자 3단: ink / ink-2(보조) / ink-3(라벨·메타). 모두 흰 바탕에서 4.5:1 이상.
- 선 2단: line(카드·구분) / line-2(표 행).

### Named Rules
- 강조색은 주 행동·현재 선택·상태 표시에만 쓴다. 장식에 쓰지 않는다.
- 같은 뜻은 같은 색: 주문 줄 칩, 결제 칩, 실행 배지, 사이드바 배지가 위 표를 공유한다.
- 비활성 요소에 채도 높은 색을 올리지 않는다(`opacity .55`).

## Typography

Pretendard Variable 한 가족. 고정 rem 스케일(유동 아님), 단계 비율 약 1.125.

### Hierarchy
- **headline** 1.25rem / 700 — 화면 제목(주문, 입금…). 화면당 하나.
- **title** 0.9375rem / 700 — 구역 제목, 상세 고객명은 1.0625rem.
- **body** 0.9375rem — 본문. 표·목록·상세는 **data** 0.875rem, 메타·보조는 0.8125rem.
- **label** 0.75rem / 700 — 칩, 배지, 표 머리글, 메트릭 라벨.
- 숫자는 전부 `tabular-nums`(`.num`).

### Named Rules
- 자간은 제목만 -0.02em. 본문·데이터는 기본.
- 기능 이름은 제품 용어를 그대로: 아침 업무, 주문 줄, 입금 대조, 출고안, 승인하고 장부 확정, 확인 질문, 근거.
- 버튼은 행동을 이름으로 쓴다(`답변 4건 반영하고 다시 계산`, `승인하고 장부 확정`). 오류는 문제와 복구를 함께 쓴다.

## Layout

- 데스크톱: `232px` 사이드바 + 본문. 본문은 `page-head`(제목·메타·검색·필터·주 행동) 고정, `page-body`가 스크롤.
- 주문 화면: `minmax(0,1fr) | minmax(360px,420px)` 목록·상세 2열. 상세는 `position: sticky` 로 따라오고 자체 스크롤.
- 1100px 이하: 상세 360px로 축소. 960px 이하: 사이드바 → 상단바 + 드로어, 2열 → 1열, 상세는 전체 화면 레이어(뒤로 버튼). 주 행동 버튼은 전체 폭.
- 간격: 카드 사이 8~14px, 구역 사이 14px, 카드 안 14/18px. 제목 위 여백 > 아래 여백.
- 표 행 높이 약 40px, 짧은 셀은 줄바꿈 금지(`white-space: nowrap`), 사유·주소만 `.wrap`.

## Elevation & Depth

평면 + 1px 선. 그림자는 드로어와 선택 상태의 안쪽 테두리 정도로만 쓴다.

### Named Rules
- 카드는 `1px solid line` 하나로 구분한다. 선과 그림자를 함께 올리지 않는다.
- 선택된 카드는 `border-color: persimmon` + `inset 0 0 0 1px persimmon` + 배경 `#fffbf7`.
- 카드 안에 카드를 넣지 않는다. 상세 안 주문 줄·입금은 구분선으로 나눈다.

## Shapes

- 컨트롤(버튼·입력·칩) 6~8px, 카드·패널 12px, 말풍선 10px, 사이드바 배지·태그만 pill.
- 아이콘은 lucide 한 벌, 선 굵기 기본. 이모지·유니코드 기호를 아이콘 대신 쓰지 않는다.

## Components

### Buttons
- `btn primary`: 감 잉크 배경, 흰 글자, 화면당 하나의 주 행동. 상태에 따라 라벨이 바뀐다(처리 → 답변 반영 → 승인 → CSV).
- `btn ghost`: 흰 배경 + line 테두리. 보조 행동(반려, 새로고침, 자료 편집).
- `btn danger`: 되돌릴 수 없는 확인(체험 다시 시작)에서만.
- `link`: 인라인 보조 행동, AI 색. `icon-btn`: 닫기·메뉴.
- 모든 버튼: hover 배경 변화, `:active` 1px 내려앉음, `:disabled` 0.55 투명, 로딩 시 Loader2 스피너.

### Chips
- 주문 줄 `chip st-*`, 결제 `chip pay-*`, 실행 `chip run-*`, 사이드바 `sb-badge`, 작은 표시 `mark`. 모두 0.72~0.75rem / 700, 6px 라운드.
- 목록에서는 짧은 라벨(`입금 대기`), 상세에서는 백엔드 전체 라벨(`입금 대기(재고 확보)`).

### Cards / Containers
- `card`(목록의 고객 묶음): 이름 · 결제 칩 · 금액 / 주문 줄들(상품×수량 · 받는 분·지역 · 상태 칩) / 확인 질문·지시문·검토 표시.
- `sec`: 흰 카드 + `sec-head`(제목 + 보조 문구/액션).
- `note ok|warn|danger|info`: 아이콘 + 문장. 왼쪽 두꺼운 색 테두리를 쓰지 않는다.
- `metric`: 작은 라벨 + 굵은 값 + 보조. 과장된 큰 숫자 금지.
- `empty`: 점선 테두리, 제목 + 다음 행동 버튼.

### Inputs / Fields
- `search`: 돋보기 + 입력 + 지우기. 포커스 시 감 테두리 + 연한 링.
- `segments`: 눌림 버튼 묶음(`aria-pressed`), 선택 항목 흰 배경, 건수 pill.
- `textarea`: surface-2 배경, 감 캐럿, 실행 중 비활성. 기본은 접힌 `inputcard` 안에 숨긴다.
- `option`(확인 질문 선택지): 라디오 + 라벨 + `추천` 태그. 선택 시 감 테두리.

### Navigation
- 사이드바: 마크·제품명 / 농가 카드(`예제 농가`) / 그룹 라벨(업무·기록) / 항목(아이콘 + 라벨 + 상태 배지) / 하단 검증 문구·버전·체험 다시 시작(2단 확인).
- 현재 항목은 흰 배경 + 감 잉크 글자. 호버는 5% 잉크.

### RunStrip (고유 컴포넌트)
- 에이전트 팀 11단계를 한 줄 pill로 보여 준다. 상태 아이콘(대기 전·처리 중·대기·완료·실패) + 짧은 이름, 호버로 전체 이름과 AI/코드/사람 구분.
- 오른쪽에 실행 배지와 `로그 N` 토글. 처리 중에는 로그가 열리고, 사람 차례가 되면 자동으로 접힌다.

### 원문 메시지 (msg)
- surface-2 말풍선, 보낸 사람·시각 메타. 근거로 쓰인 메시지는 연한 감 배경 + `근거` 표시.
- 가명화 토큰 `[전화N]`은 `전화번호` 칩으로, `mN` 참조는 `HH:MM 메시지`로 바꿔 보여 준다.

## Do's and Don'ts

- Do: 상태마다 주 행동 버튼은 하나만, 헤더 오른쪽에.
- Do: AI가 만든 줄에는 `AI 제안/해석/작성` 태그와 근거를 붙인다.
- Do: 장부에 반영되지 않았다는 사실을 승인 전 화면마다 한 줄로 말한다.
- Don't: 없는 기능(송장 회신, 일일 마감, 클레임, 장부 대화)을 메뉴나 버튼으로 보이게 하지 않는다.
- Don't: 제목 위 작은 소제목(eyebrow), 그라데이션 글자, 카드 안의 카드, 장식용 모션.
- Don't: 스피너를 콘텐츠 한가운데 두지 않는다. 처리 중에는 단계 스트립과 원문이 보인다.
