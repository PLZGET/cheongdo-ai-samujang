import { Line, Payment, Plan, Question, Run, TERMINAL, Workspace } from "./api";

export type View = "today" | "orders" | "deposits" | "shipments" | "ledger" | "evaluation";
export const VIEWS: View[] = ["today", "orders", "deposits", "shipments", "ledger", "evaluation"];

export const RUN_STATUS_TEXT: Record<string, string> = {
  running: "처리 중",
  waiting_questions: "사장님 확인 대기",
  waiting_approval: "승인 대기",
  completed: "확정 완료",
  rejected: "반려됨",
  conflict: "장부 충돌",
  failed: "실패",
};

export const LINE_SHORT: Record<string, string> = {
  ship_today: "오늘 출고",
  scheduled: "출고 예약",
  wait_payment: "입금 대기",
  wait_address: "주소 대기",
  wait_confirm: "확인 대기",
  date_conflict: "발송일 충돌",
  short_stock: "재고 부족",
  hold: "보류",
  cancelled: "취소",
};

export const PAY_TEXT: Record<string, string> = {
  paid: "입금 완료",
  partial: "일부 입금",
  unpaid: "미입금",
  over: "초과 입금",
  none: "금액 없음",
};

export const STEPS: { id: string; label: string; short: string; kind: "ai" | "code" | "human" }[] = [
  { id: "prepare", label: "입력 정리·가명화", short: "정리", kind: "code" },
  { id: "intake", label: "접수 에이전트 ×3", short: "접수", kind: "ai" },
  { id: "finance", label: "정산 에이전트", short: "정산", kind: "ai" },
  { id: "shipping", label: "배송 에이전트", short: "배송", kind: "ai" },
  { id: "plan", label: "계획 엔진", short: "계획", kind: "code" },
  { id: "review", label: "검토 에이전트", short: "검토", kind: "ai" },
  { id: "questions", label: "사장님 확인", short: "확인", kind: "human" },
  { id: "replan", label: "재계산", short: "재계산", kind: "code" },
  { id: "comms", label: "고객응대 에이전트", short: "응대", kind: "ai" },
  { id: "approval", label: "승인", short: "승인", kind: "human" },
  { id: "commit", label: "장부 확정", short: "확정", kind: "code" },
];

export const STEP_LABEL: Record<string, string> = {
  ...Object.fromEntries(STEPS.map((s) => [s.id, s.label])),
  intake_1: "접수 1",
  intake_2: "접수 2",
  intake_3: "접수 3",
  reintake: "재접수",
};

export type StepState = "idle" | "running" | "done" | "failed" | "waiting";

export function stepStates(run: Run | null): Record<string, StepState> {
  const out: Record<string, StepState> = {};
  if (!run) return out;
  const group = (step?: string) => (step?.startsWith("intake") || step === "reintake" ? "intake" : step ?? "");
  const counts: Record<string, { running: number; done: number; failed: number; waiting: boolean; last?: string }> = {};
  for (const e of run.events) {
    if (!e.step) continue;
    const g = group(e.step);
    const c = (counts[g] ??= { running: 0, done: 0, failed: 0, waiting: false });
    if (e.status === "running") c.running += 1;
    else if (e.status === "done") c.done += 1;
    else if (e.status === "failed") c.failed += 1;
    else if (e.status === "waiting") c.waiting = true;
    c.last = e.status;
  }
  for (const [g, c] of Object.entries(counts)) {
    if (c.running > c.done + c.failed) out[g] = "running";
    else if (c.last === "waiting" && !TERMINAL.has(run.status) && run.status !== "running") out[g] = "waiting";
    else if (c.failed && !c.done) out[g] = "failed";
    else out[g] = "done";
  }
  return out;
}

export type Group = {
  customer: string;
  lines: Line[];
  payment: Payment | null;
  deposits: Plan["deposits"];
  questions: Question[];
  flags: Plan["flags"];
  findings: NonNullable<Plan["review"]>["findings"];
  inquiries: Plan["inquiries"];
  notes: Plan["notes"];
  cancellations: Plan["cancellations"];
  refunds: Plan["refunds"];
  messages: Plan["messages"];
  evidenceIds: Set<string>;
  evidenceCount: number;
  draft: NonNullable<Plan["drafts"]>[number] | null;
  attention: boolean;
  shipToday: boolean;
  waiting: boolean;
  amount: number;
};

const ATTENTION = new Set(["wait_confirm", "short_stock", "hold", "date_conflict", "wait_address"]);
const WAITING = new Set(["scheduled", "wait_payment", "wait_address", "date_conflict", "short_stock", "hold", "wait_confirm"]);

export function groupPlan(plan: Plan): Group[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const touch = (c?: string | null) => {
    if (!c || seen.has(c)) return;
    seen.add(c);
    order.push(c);
  };
  plan.messages.forEach((m) => touch(m.sender));
  plan.lines.forEach((l) => touch(l.customer));
  Object.keys(plan.payments).forEach((c) => c !== "_unmatched" && touch(c));
  plan.questions.forEach((q) => touch(q.customer));
  plan.inquiries.forEach((i) => touch(i.customer));
  plan.flags.forEach((f) => touch(f.customer));

  return order
    .map((customer) => {
      const lines = plan.lines.filter((l) => l.customer === customer);
      const evidenceIds = new Set(lines.flatMap((l) => l.source_ids));
      plan.questions.filter((q) => q.customer === customer).forEach((q) => q.evidence.forEach((e) => evidenceIds.add(e.id)));
      const messages = plan.messages.filter((m) => m.sender === customer || evidenceIds.has(m.id));
      const questions = plan.questions.filter((q) => q.customer === customer);
      const flags = plan.flags.filter((f) => f.customer === customer);
      const findings = (plan.review?.findings ?? []).filter((f) => f.customer === customer);
      const active = lines.filter((l) => l.status !== "cancelled");
      const g: Group = {
        customer,
        lines,
        payment: plan.payments[customer] ?? null,
        deposits: plan.deposits.filter((d) => d.customer === customer),
        questions,
        flags,
        findings,
        inquiries: plan.inquiries.filter((i) => i.customer === customer),
        notes: plan.notes.filter((n) => n.customer === customer),
        cancellations: plan.cancellations.filter((c) => c.customer === customer),
        refunds: plan.refunds.filter((r) => r.customer === customer),
        messages,
        evidenceIds,
        evidenceCount: messages.filter((m) => evidenceIds.has(m.id)).length,
        draft: plan.drafts?.find((d) => d.customer === customer) ?? null,
        attention: questions.length > 0 || flags.length > 0 || findings.some((f) => f.severity === "critical") || active.some((l) => ATTENTION.has(l.status)),
        shipToday: active.some((l) => l.status === "ship_today"),
        waiting: active.some((l) => WAITING.has(l.status)),
        amount: active.filter((l) => !["hold", "wait_confirm"].includes(l.status)).reduce((a, l) => a + l.amount, 0),
      };
      return g;
    })
    .filter((g) => g.lines.length || g.questions.length || g.inquiries.length || g.flags.length || g.deposits.length);
}

/** 선택되지 않은 입금처럼 고객 묶음 밖에 있는 질문. */
export function orphanQuestions(plan: Plan, groups: Group[]): Question[] {
  const names = new Set(groups.map((g) => g.customer));
  return plan.questions.filter((q) => !names.has(q.customer));
}

export function todayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const w = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const w = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

export function clock(iso: string | null | undefined) {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : "";
}

/** 입력창 요약용. 카카오톡 내보내기 형식의 메시지 줄과 입금 문자를 센다. */
export function countInputs(inbox: string, deposits: string) {
  const messages = inbox.split("\n").filter((l) => /^\[[^\]]+\]\s*\[[^\]]+\]/.test(l.trim())).length;
  const depositCount = deposits.split("\n").filter((l) => /입금/.test(l)).length;
  return { messages, deposits: depositCount };
}

export type Task = { title: string; detail: string; view: View; action?: "start" | "answer" | "approve" | "download" | "retry" };

export function currentTask(ws: Workspace, run: Run | null): Task {
  if (!run) {
    return { title: "밤사이 들어온 자료를 정리하세요", detail: "카카오톡 대화와 입금 문자를 읽어 오늘 보낼 주문을 뽑아냅니다. 약 1~3분 걸립니다.", view: "orders", action: "start" };
  }
  switch (run.status) {
    case "running":
      return { title: "AI 사무장이 처리하고 있습니다", detail: "접수·정산·배송 에이전트가 메시지를 나눠 읽는 중입니다. 다른 화면을 봐도 계속 진행됩니다.", view: "orders" };
    case "waiting_questions": {
      const n = run.pending?.data.questions?.length ?? 0;
      return { title: `확인 질문 ${n}건에 답해 주세요`, detail: "추천 답이 미리 선택되어 있습니다. 바꿀 항목만 고르고 반영하면 다시 계산합니다.", view: "orders", action: "answer" };
    }
    case "waiting_approval":
      return { title: "출고안을 검토하고 승인하세요", detail: "승인하기 전까지 장부와 재고는 바뀌지 않습니다. 고객별 근거와 입금 대조를 확인하세요.", view: "orders", action: "approve" };
    case "completed":
      return { title: "장부 확정이 끝났습니다", detail: `택배 일괄접수 CSV와 포장 지시서를 내려받아 포장을 시작하세요. 확정 주문 ${ws.state.ledger.orders.length}줄.`, view: "shipments", action: "download" };
    case "rejected":
      return { title: "출고안을 반려했습니다", detail: "장부는 바뀌지 않았습니다. 자료를 고쳐 다시 처리할 수 있습니다.", view: "orders", action: "retry" };
    case "conflict":
      return { title: "승인 전에 장부가 바뀌어 확정하지 않았습니다", detail: "최신 장부로 다시 처리해 주세요.", view: "orders", action: "retry" };
    case "cancelled":
      return { title: "AI 처리를 취소했습니다", detail: "확정 전에 취소해 장부·재고는 바뀌지 않았습니다. 다시 처리할 수 있습니다.", view: "orders", action: "retry" };
    default:
      return { title: "처리 중 오류가 발생했습니다", detail: run.error ?? "입력을 확인한 뒤 다시 처리해 주세요. 장부는 바뀌지 않았습니다.", view: "orders", action: "retry" };
  }
}
