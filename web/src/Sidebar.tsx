import { useState } from "react";
import { Banknote, BookOpen, ClipboardList, Loader2, RotateCcw, Sun, Target, Truck } from "lucide-react";
import { Run, Workspace } from "./api";
import { View, todayLabel } from "./model";

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="18" r="12" fill="var(--persimmon)" />
      <rect x="13" y="3" width="6" height="6" rx="2" fill="var(--leaf)" />
    </svg>
  );
}

const ITEMS: { group: string; items: { id: View; label: string; icon: typeof Sun }[] }[] = [
  {
    group: "업무",
    items: [
      { id: "today", label: "오늘 업무", icon: Sun },
      { id: "orders", label: "주문", icon: ClipboardList },
      { id: "deposits", label: "입금", icon: Banknote },
      { id: "shipments", label: "출고", icon: Truck },
    ],
  },
  {
    group: "기록",
    items: [
      { id: "ledger", label: "장부", icon: BookOpen },
      { id: "evaluation", label: "정답 대조", icon: Target },
    ],
  },
];

export function navBadge(id: View, ws: Workspace, run: Run | null): { text: string; tone: "warn" | "info" | "ok" | "muted" } | null {
  if (id === "orders" && run) {
    if (run.status === "running") return { text: "처리 중", tone: "info" };
    if (run.status === "waiting_questions") return { text: `확인 ${run.pending?.data.questions?.length ?? 0}`, tone: "warn" };
    if (run.status === "waiting_approval") return { text: "승인 대기", tone: "warn" };
  }
  if (id === "shipments" && ws.state.ledger.shipments.some((s) => !s.tracking)) {
    return { text: `${ws.state.ledger.shipments.filter((s) => !s.tracking).length}`, tone: "ok" };
  }
  if (id === "evaluation" && ws.state.ledger.orders.length === 0) return { text: "확정 후", tone: "muted" };
  return null;
}

export default function Sidebar({
  ws,
  run,
  view,
  onNavigate,
  onRestart,
  busy,
}: {
  ws: Workspace;
  run: Run | null;
  view: View;
  onNavigate: (v: View) => void;
  onRestart: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <Mark />
        <div>
          <strong>AI 사무장</strong>
          <span>청도 농가</span>
        </div>
      </div>

      <div className="sb-farm">
        <div className="sb-farm-row">
          <b>{ws.state.farm.name.replace(/\(가상\)$/, "")}</b>
          <span className="tag">예제 농가</span>
        </div>
        <span className="muted small">
          {ws.state.farm.owner} · 기준일 {todayLabel(ws.state.business_date)}
        </span>
      </div>

      <nav className="sb-nav" aria-label="업무 메뉴">
        {ITEMS.map((g) => (
          <div key={g.group} className="sb-group">
            <span className="sb-group-label">{g.group}</span>
            {g.items.map((it) => {
              const badge = navBadge(it.id, ws, run);
              const Icon = it.icon;
              return (
                <button key={it.id} type="button" className={view === it.id ? "sb-item on" : "sb-item"} aria-current={view === it.id ? "page" : undefined} onClick={() => onNavigate(it.id)}>
                  <Icon size={17} aria-hidden />
                  <span>{it.label}</span>
                  {badge && <span className={`sb-badge ${badge.tone}`}>{badge.text}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sb-foot">
        <p className="muted">
          예제의 사람·주소·전화번호는 합성 데이터입니다. AI 제안은 승인 전까지 장부에 반영되지 않습니다. 입력한 대화의 이름·주소·주문 내용은 외부 AI 모델(GitHub Copilot)로 전송되며 전화번호만 토큰으로 바꿔 보냅니다. 체험 자료는 마지막 변경 7일 뒤 자동 삭제됩니다.
        </p>
        <p className="muted num">버전 {ws.version.slice(0, 7)}</p>
        {confirming ? (
          <div className="sb-confirm" role="group" aria-label="체험 다시 시작 확인">
            <span>새 작업공간에서 예제를 처음부터 시작할까요? 이 브라우저는 새 작업공간으로 옮겨 가며, 지금 작업공간은 삭제되지 않고 7일 보관 후 자동 삭제됩니다.</span>
            <div>
              <button
                type="button"
                className="btn danger sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRestart();
                }}
              >
                {busy ? <Loader2 size={14} className="spin" aria-hidden /> : null} 다시 시작
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
                취소
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => setConfirming(true)} disabled={busy}>
            <RotateCcw size={14} aria-hidden /> 체험 다시 시작
          </button>
        )}
      </div>
    </aside>
  );
}
