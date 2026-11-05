export type Option = { value: string; label: string; recommended: boolean };
export type Evidence = { id: string; at: string; text: string };
export type Question = {
  id: string;
  type: string;
  customer: string;
  title: string;
  detail: string;
  evidence: Evidence[];
  options: Option[];
};

export type Line = {
  line_id: string;
  customer: string;
  product: string;
  product_name: string;
  qty: number;
  recipient: string;
  address: string | null;
  address_raw: string | null;
  phone: string | null;
  source_ids: string[];
  history: string;
  from_last_year: boolean;
  requested_when: string | null;
  status: string;
  status_label: string;
  ship_date?: string | null;
  shipping_verified?: boolean;
  verify_issue?: string;
  amount: number;
  region: string;
};

export type Payment = { total: number; paid: number; balance: number; status: string; completed_at: string | null; deposit_ids: string[] };
export type DepositRow = { id: string; payer: string; amount: number; at: string; raw: string; customer: string | null; confirmed: boolean; by: string | null; reason: string; unmatched: boolean };
export type Draft = { customer: string; text: string; amount_check: string; unknown_amounts: number[] };

export type Plan = {
  messages: { id: string; at: string; sender: string; text: string }[];
  lines: Line[];
  cancellations: { customer: string; product: string; qty: number; note: string; evidence: Evidence[] }[];
  flags: { customer: string; source_id: string; text: string }[];
  inquiries: { customer: string; text: string }[];
  notes: { customer: string; text: string }[];
  payments: Record<string, Payment>;
  deposits: DepositRow[];
  refunds: { customer: string; amount: number; reason: string }[];
  questions: Question[];
  inventory_before: Record<string, { on_hand: number; reserved: number }>;
  inventory_after: Record<string, { on_hand: number; reserved: number }>;
  shortages: { product: string; product_name: string; qty: number; alternatives: string[] }[];
  counts: { ship_today_boxes: number; ship_today_parcels: number; customers: number; messages: number; deposits: number };
  drafts?: Draft[];
  review?: { round: number; findings: { customer: string; severity: string; issue: string; fix: string }[] };
};

export type RunEvent = { seq: number; ts: number; kind: string; step?: string; status?: string; text?: string };

export type Run = {
  run_id: string;
  type: string;
  status: string;
  events: RunEvent[];
  pending: null | { request_id: string; kind: string; data: { kind: string; questions?: Question[]; plan: Plan } };
  result: null | { status: string; summary?: Record<string, number> };
  error: string | null;
  created_at: number;
  plan: Plan | null;
};

export type Workspace = {
  wsid: string;
  version: string;
  state: {
    business_date: string;
    farm: { name: string; owner: string };
    catalog: Record<string, { code: string; name: string; price: number; pieces: number; perishable: boolean }>;
    inventory: Record<string, { on_hand: number; reserved: number }>;
    policy: Record<string, unknown>;
    ledger: {
      orders: (Line & { order_id: string })[];
      payments: { deposit_id: string; customer: string; payer: string; amount: number; at: string; matched_by: string }[];
      refunds: { customer: string; amount: number; reason: string; status: string }[];
      shipments: { shipment_id: string; order_id: string; recipient: string; address: string; product_name: string; qty: number; ship_date: string; tracking: string | null }[];
      events: Record<string, unknown>[];
    };
    samples: { inbox: string; deposits: string; claim_message: string };
  };
  runs: { run_id: string; type: string; status: string; created_at: number }[];
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** status 0: 응답을 받지 못한 통신 오류·시간 초과. 서버 작업은 계속됐을 수 있다. */
export const isTransient = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 429;

async function request<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init, signal: ctrl.signal });
  } catch {
    throw new ApiError(
      ctrl.signal.aborted
        ? "서버 응답이 늦습니다. 화면의 요청만 멈춘 것이며 서버 작업은 계속될 수 있습니다. 잠시 후 다시 확인해 주세요."
        : "서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.",
      0,
    );
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string; copilot: string; store: string }>("/api/health"),
  createWorkspace: () => request<{ wsid: string }>("/api/workspaces", { method: "POST" }),
  workspace: (wsid: string) => request<Workspace>(`/api/workspaces/${wsid}`),
  startMorning: (wsid: string, inbox: string, deposits: string) =>
    request<Run>(`/api/workspaces/${wsid}/runs/morning`, { method: "POST", body: JSON.stringify({ inbox, deposits }) }),
  run: (wsid: string, runId: string) => request<Run>(`/api/workspaces/${wsid}/runs/${runId}`),
  respond: (wsid: string, runId: string, body: { request_id: string; answers?: Record<string, string>; decision?: string }) =>
    request<Run>(`/api/workspaces/${wsid}/runs/${runId}/respond`, { method: "POST", body: JSON.stringify(body) }, 30000),
  cancel: (wsid: string, runId: string) => request<Run>(`/api/workspaces/${wsid}/runs/${runId}/cancel`, { method: "POST" }),
  evaluation: (wsid: string) => request<Evaluation>(`/api/workspaces/${wsid}/evaluation`),
  eventsUrl: (wsid: string, runId: string) => `/api/workspaces/${wsid}/runs/${runId}/events`,
};

export type Evaluation = {
  note: string;
  summary: Record<string, { matched: number; total: number }>;
  extra_lines: Record<string, unknown>[];
  details: Record<string, ({ match: boolean } & Record<string, unknown>)[]>;
};

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export const TERMINAL = new Set(["completed", "rejected", "conflict", "failed", "cancelled"]);
