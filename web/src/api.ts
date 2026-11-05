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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* 본문 없음 */
    }
    throw new Error(message);
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
    request<Run>(`/api/workspaces/${wsid}/runs/${runId}/respond`, { method: "POST", body: JSON.stringify(body) }),
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
export const TERMINAL = new Set(["completed", "rejected", "conflict", "failed"]);
