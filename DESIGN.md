---
name: 청도 농가 AI 사무장
description: 선명한 초록, 흰 작업면, 회색 탐색 영역과 얇은 구분선으로 정리한 농가 업무 도구.
colors:
  brand: "#03c75a"
  green: "#087f46"
  green-hover: "#066b3b"
  green-soft: "#eaf8ef"
  surface-active: "#f1faf4"
  bg: "#f5f6f8"
  surface: "#ffffff"
  surface-2: "#f7f8fa"
  ink: "#202428"
  muted: "#626973"
  line: "#e5e7eb"
  line-2: "#edf0f2"
  sky: "#2b4c7e"
  sky-soft: "#e4ecf5"
  warn: "#8a5300"
  warn-soft: "#fff3dc"
  danger: "#b42318"
  danger-soft: "#fdeceb"
  ai: "#3c4f9a"
  ai-soft: "#eaeefb"
typography:
  display:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4.5vw, 3.5rem)"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  customer-title:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "16px"
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
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  compact: "5px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  compact: "12px"
  md: "16px"
  section: "20px"
  lg: "24px"
  pane: "28px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  order-button:
    rounded: "{rounded.compact}"
  search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "5px 9px"
  sidebar-item-active:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green}"
    rounded: "{rounded.sm}"
    padding: "12px 10px"
  chip:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.1rem 0.5rem"
  section-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "22px 24px"
  customer-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "13px 18px"
  customer-row-selected:
    backgroundColor: "{colors.green-soft}"
  message:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.compact}"
    padding: "12px 14px"
---

# Design System: 청도 농가 AI 사무장

## Overview

**Creative North Star: "주문 작업함"**

고객과 처리 상태를 빠르게 읽는 흰 작업면을 중심으로 한다. 회색 탐색 영역, 얇은 구분선, 또렷한 한글을 사용하고, 선명한 초록은 제품 마크와 선택 표시를 맡는다. 행동과 링크에는 더 짙은 초록을 쓴다.

사용자가 선택한 B 방향을 실제 구현에서 추출했다. 기존 감색·크림색 농가 테마와 설명이 화면을 차지하는 구성은 교체했다. 네이버 서비스의 익숙한 탐색 감각을 참고하되 제품명과 자체 감 모양 마크를 유지한다.

**Key Characteristics:**

- 흰 작업면과 회색 탐색 영역을 얇은 선으로 구분한다.
- 초록의 밝기 차이로 제품 정체성과 실행 행동을 구별한다.
- 카드 장식보다 고객 행, 근거 메시지, 질문의 읽기 순서를 우선한다.
- 작은 화면에서도 고객 목록과 상세 사이의 이동·포커스를 유지한다.

추출 기준은 `web/src/styles.css`, `workspace.css`, `orders.css`의 최종 적용값과 `App.tsx`, `Sidebar.tsx`, `Orders.tsx`다. 화면별 방향 계약은 `.impeccable/surfaces/web-src-app-tsx.md`에 둔다.

## Colors

차가운 회색 중립층에 초록을 더하고 업무 상태에는 의미가 정해진 보조색을 쓴다. 값은 위 토큰을 기준으로 한다.

### Primary

- **브랜드 초록 · brand:** 자체 마크, 질문이 있는 고객의 점, 현재 주문 필터의 밑줄.
- **행동 초록 · green / green-hover:** 주 행동, 링크, 현재 메뉴 글자, 포커스와 라디오 선택.
- **선택 연초록 · green-soft:** 현재 메뉴·고객 행, 완료·입금 완료·오늘 출고 표시.
- **작업 연초록 · surface-active:** 대기 작업 영역과 상세 전환 시작 배경.

### Secondary

- **예약 파랑 · sky / sky-soft:** 오늘 이후 출고 예약.
- **확인 황갈색 · warn / warn-soft:** 입금·주소·확인 대기, 사장님 질문·승인 차례.
- **오류 빨강 · danger / danger-soft:** 보류·재고 부족·미입금·실패와 확인 단계의 다시 시작 버튼.
- **AI 남색 · ai / ai-soft:** 처리 중, AI 표시, 초과 입금. 주문 상세의 작은 AI 출처 표시는 보조 글자색으로 낮춘다.

### Neutral

- **작업 배경 · bg:** 앱 배경·사이드바, 주문 상세의 메시지·근거·안내 초안 채움.
- **작업면 · surface / 보조 채움 · surface-2:** 흰 패널과 일반 입력·로그·호버 상태.
- **본문 · ink / 보조 · muted:** 제목·본문과 메타데이터의 두 단계. 기존 `ink-2`, `ink-3`는 같은 보조색이다.
- **구분선 · line / line-2:** 패널 경계와 내부 행 경계.

**The 초록 역할 분리 Rule.** 밝은 브랜드 초록은 작은 식별 표시에 쓰고, 실행 버튼과 읽어야 하는 초록 글자는 행동 초록을 쓴다.

## Typography

Pretendard Variable을 로컬 패키지에서 불러오고 Pretendard, system-ui, sans-serif로 대체한다. 하나의 글꼴 안에서 크기·굵기·행간으로 위계를 만든다.

- **Display:** 시작 화면 제목만 사용하는 유동 크기다.
- **Headline / Customer title:** 화면 제목과 선택한 고객명. 고객명은 한 단계 가벼운 굵기다.
- **Title:** 일반 구역 제목. 주문 목록 제목은 18px / 650, 상세 구역 제목은 데스크톱 14px, 모바일 15px다.
- **Body / Data:** 기본 본문과 표·작업 데이터. 원문 메시지는 데스크톱 14px / 1.65, 모바일 15px다.
- **Meta / Label:** 설명·시각·건수와 상태 칩. 고객 행은 이름 15px / 650, 미리보기 13px이며 모바일에서 각각 16px, 14px다.

**The 숫자 정렬 Rule.** 금액·수량·날짜의 숫자에는 `tabular-nums`를 적용한다. 제목 자간은 좁히고 본문은 기본 간격을 유지한다.

## Layout

- 앱 셸은 상단바(64px), 사이드바(184px), 남은 너비의 본문으로 구성한다. 본문은 제목 영역 아래에서 스크롤한다.
- 주문 작업함은 고객 목록(300px)과 가변 상세를 맞붙인다. 고객 행은 최소 74px, 상세 내부는 좌우 32px다.
- 자료·처리 현황은 최소 40px의 접기 행이다. 실행 전·처리 중·승인 대기에는 펼치고, 질문 대기에는 접어 원문과 질문을 앞에 둔다.
- 일반 업무 화면은 본문 좌우 30px, 구역 간격 20px, 패널 내부 22px 24px다. 주문 목록의 연속 행과는 구별한다.
- 1100px 이하에서 주문 헤더 행동을 줄바꿈하고 상세 내부 간격을 23px로 줄인다.
- 960px 이하에서 사이드바를 드로어로 바꾸고 상단바를 60px로 줄인다. 드로어는 280px, 최대 화면 너비의 85%다.
- 760px 이하에서 주문 목록과 상세를 하나씩 보여 준다. 고객 선택 시 상세 제목에 포커스를 주고, 목록으로 돌아오면 선택 행에 복원한다. 상세 좌우 간격은 20px다.
- 모바일 검색·자료 입력 글자는 16px, 고객 행은 최소 78px다. 답변 반영 버튼은 전체 폭, 최소 44px다.

## Elevation & Depth

평면을 기본으로 흰 작업면·회색 채움·1px 선을 조합한다. 주문 작업함의 목록·상세에는 그림자를 쓰지 않는다. 일반 구역 패널은 둥근 모서리와 선으로 구분한다.

- **드로어:** `--shadow`의 낮은 확산 그림자를 열린 모바일 메뉴에 적용한다.
- **입력 포커스:** 연초록 3px 링과 행동 초록 경계선.
- **선택 표시:** 일반 필터의 작은 음영, 주문 필터의 2px 안쪽 밑줄.

**The 평면 작업면 Rule.** 목록·상세의 위계는 여백과 구분선으로 만들고, 그림자는 입력·선택 상태와 화면 위에 뜨는 메뉴에 한정한다.

## Shapes

주문 화면의 버튼·검색·메시지는 `compact`, 공통 버튼·메뉴·칩은 `sm`, 일반 구역 패널은 `lg` 모서리를 쓴다. 고객 행과 상세 구역은 직각으로 이어지고 질문은 테두리 카드 없이 네이티브 라디오로 표시한다. pill은 작은 태그·배지·진행 단계에 쓰며 아바타는 원형이다.

아이콘은 lucide-react의 선 아이콘이다. 자체 감 실루엣 SVG 마크를 두 초록으로 채운다.

## Components

### Buttons

행동 초록 주 버튼, 흰색·얇은 선 보조 버튼, 빨간 확인 버튼으로 구별한다. 공통 버튼은 최소 38px이며 주문 화면은 작은 모서리와 13px 글자를 쓴다. 모바일 주문 헤더 버튼은 최소 42px다.

호버는 배경·경계색이 150ms로 바뀐다. 눌림은 1px 내려가고 비활성은 불투명도 0.55다. 키보드 포커스는 행동 초록 2px 선이며 주문 화면은 바깥 간격 3px를 둔다. 처리 중은 버튼 안 스피너와 행동 문구로 표시한다.

### Chips

상태 칩은 작은 둥근 모서리와 굵은 라벨을 공유한다. 주문·결제·실행 상태는 텍스트와 의미색을 함께 제공하고 취소에는 취소선을 더한다. 사이드바 배지는 더 작은 pill이다.

### Cards / Containers

일반 흰 구역 패널은 얇은 선과 큰 모서리를 쓴다. 주문 작업함에서는 연속 고객 행과 상세 구분선이 컨테이너다. 원문·근거·안내 초안은 회색 채움으로 구분한다. 빈 상태에는 제목과 다음 행동을 둔다.

### Inputs / Fields

검색은 돋보기·입력·지우기로 구성한다. 주문 필터는 텍스트 탭이며 현재 항목 아래 브랜드 초록 선을 표시한다. 자료 편집은 접힌 영역에서 열고 처리 중 비활성화한다. 질문은 설명·근거 토글·라디오 선택지·추천 표시를 묶는다.

### Navigation

회색 사이드바에 아이콘·메뉴명·배지를 정렬한다. 현재 메뉴는 연초록 배경과 행동 초록 글자다. 모바일 드로어는 Escape로 닫고 포커스를 내부에 유지하며, 닫으면 메뉴 버튼에 복원한다. 본문 바로가기는 포커스를 받으면 나타난다.

### 고객 작업 행과 상세

행에는 고객명, 질문·입금 상태, 주문 요약을 넣는다. 선택 배경과 상세 고객명이 함께 바뀐다. 질문이 있는 고객은 원문 → 주문·입금 요약 → 확인 질문 → 주문 줄·입금 내역 순서다. 답변 반영은 다른 고객의 질문도 함께 처리한다는 문구를 버튼 옆에 둔다.

고객 전환은 220ms 동안 연초록에서 흰 배경으로 바뀐다. 모션 감소 설정에서는 상세 애니메이션을 끄고 일반 전환 시간을 최소화하며 처리 스피너는 3초 주기로 늦춘다.

### 처리 현황

진행 단계·실행 배지·로그 토글을 자료·처리 현황 안에 묶는다. 모바일 단계 목록은 4열이다. 보조 정보를 접어도 실행 상태와 다음 행동은 헤더에서 확인할 수 있다.

## Do's and Don'ts

### Do:

- **Do** 행동 초록과 브랜드 초록의 역할을 구분한다.
- **Do** 고객 선택, 상태 문구, 키보드 포커스가 같은 작업 맥락을 가리키게 한다.
- **Do** AI 출처와 근거, 승인 전 장부·재고 미반영 문구를 읽을 수 있게 둔다.
- **Do** 예제 농가와 합성 자료 표시를 실제 사용자 정보와 구분한다.

### Don't:

- **Don't** 이전 감색·크림색 농가 테마를 다시 섞는다.
- **Don't** 네이버 로고나 공식 서비스라는 표현을 사용한다.
- **Don't** 목록·상세를 장식 카드로 잘게 나누거나 큰 설명 블록으로 작업을 밀어낸다.
- **Don't** 없는 기능을 메뉴·버튼으로 제시하거나 색만으로 상태를 전달한다.
