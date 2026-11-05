import { useMemo, useState } from "react";
import { Download, Truck } from "lucide-react";
import { Plan, Run, Workspace, won } from "./api";
import { View, shortDate } from "./model";
import { EmptyState, LineChip, PageHeader, RunBadge, SearchBox, Segments } from "./ui";

type Seg = "today" | "scheduled" | "all";

export default function Shipments({ ws, plan, run, onNavigate }: { ws: Workspace; plan: Plan | null; run: Run | null; onNavigate: (v: View) => void }) {
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<Seg>("today");
  const { ledger, inventory, catalog } = ws.state;
  const committed = ledger.shipments.length > 0;
  const today = ws.state.business_date;

  // 확정 전에는 출고안의 줄을, 확정 후에는 장부의 출고 기록을 보여 준다.
  const rows = useMemo(() => {
    if (committed) {
      return ledger.shipments.map((s) => ({
        id: s.shipment_id,
        order_id: s.order_id,
        recipient: s.recipient,
        address: s.address,
        product: s.product_name,
        qty: s.qty,
        ship_date: s.ship_date,
        status: s.ship_date === today ? "ship_today" : "scheduled",
        label: s.ship_date === today ? "오늘 출고" : "출고 예약",
        tracking: s.tracking,
        source: "ledger" as const,
      }));
    }
    return (plan?.lines ?? [])
      .filter((l) => ["ship_today", "scheduled", "wait_payment", "wait_address", "date_conflict"].includes(l.status))
      .map((l) => ({
        id: l.line_id,
        order_id: l.line_id,
        recipient: l.recipient,
        address: l.address ?? l.address_raw ?? "",
        product: l.product_name,
        qty: l.qty,
        ship_date: l.ship_date ?? null,
        status: l.status,
        label: l.status_label,
        tracking: null as string | null,
        source: "plan" as const,
      }));
  }, [committed, ledger.shipments, plan, today]);

  const counts = {
    today: rows.filter((r) => r.status === "ship_today").length,
    scheduled: rows.filter((r) => r.status !== "ship_today").length,
    all: rows.length,
  };
  const visible = rows.filter((r) => {
    if (seg === "today" && r.status !== "ship_today") return false;
    if (seg === "scheduled" && r.status === "ship_today") return false;
    const q = query.trim();
    return !q || [r.recipient, r.address, r.product, r.order_id].join(" ").includes(q);
  });
  const boxesToday = rows.filter((r) => r.status === "ship_today").reduce((a, r) => a + r.qty, 0);
  const pending = ledger.shipments.filter((s) => !s.tracking).length;

  return (
    <div className="page">
      <PageHeader
        title="출고"
        meta={
          <>
            <RunBadge run={run} />
            <span>
              {committed ? `확정 출고 ${ledger.shipments.length}건 · 송장 대기 ${pending}건` : plan ? `출고안 ${rows.length}건 · 오늘 ${counts.today}건 ${boxesToday}박스 (승인 전)` : "처리 전"}
            </span>
          </>
        }
        tools={
          rows.length > 0 && (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="받는 분·주소·상품 검색" />
              <Segments
                label="출고 필터"
                value={seg}
                onChange={setSeg}
                items={[
                  { id: "today", label: "오늘 출고", count: counts.today },
                  { id: "scheduled", label: "예약·대기", count: counts.scheduled },
                  { id: "all", label: "전체", count: counts.all },
                ]}
              />
            </>
          )
        }
      >
        {committed ? (
          <>
            <a className="btn ghost" href={`/api/workspaces/${ws.wsid}/exports/packing.csv`}>
              <Download size={16} aria-hidden /> 포장 지시서
            </a>
            <a className="btn primary" href={`/api/workspaces/${ws.wsid}/exports/courier.csv`}>
              <Download size={16} aria-hidden /> 택배 일괄접수 CSV
            </a>
          </>
        ) : (
          <span className="muted small">승인 후 CSV를 내려받을 수 있습니다</span>
        )}
      </PageHeader>

      <div className="page-body">
        {rows.length === 0 ? (
          <EmptyState icon={<Truck size={22} aria-hidden />} title="출고할 주문이 아직 없습니다" detail="아침 업무를 처리하고 승인하면 오늘 보낼 택배와 포장 지시서가 여기에 정리됩니다.">
            <button type="button" className="btn primary" onClick={() => onNavigate("orders")}>
              주문 화면으로
            </button>
          </EmptyState>
        ) : (
          <section className="sec">
            <div className="sec-head">
              <h2>{committed ? "확정된 출고" : "출고안 (승인 전)"}</h2>
              {!committed && <span className="muted small">승인하면 오늘 출고분은 재고에서 빠지고 예약분은 확보됩니다.</span>}
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>발송일</th>
                    <th>받는 분</th>
                    <th>주소</th>
                    <th>상품</th>
                    <th className="num">수량</th>
                    <th>상태</th>
                    {committed && <th>송장</th>}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.ship_date ? shortDate(r.ship_date) : <span className="muted">미정</span>}</td>
                      <td>{r.recipient}</td>
                      <td className="muted wrap">{r.address || <span className="warn-text">주소 없음</span>}</td>
                      <td>{r.product}</td>
                      <td className="num">{r.qty}</td>
                      <td>
                        <LineChip status={r.status} label={r.label} />
                      </td>
                      {committed && <td className="muted small">{r.tracking ?? "송장 대기"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length === 0 && <EmptyState title="조건에 맞는 출고가 없습니다" />}
          </section>
        )}

        <section className="sec">
          <div className="sec-head">
            <h2>재고</h2>
            <span className="muted small">{committed ? "확정 반영 후" : "현재 장부 기준"}</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">보유</th>
                <th className="num">확보</th>
                <th className="num">출고 가능</th>
                {plan && !committed && <th className="num">승인 후 보유</th>}
              </tr>
            </thead>
            <tbody>
              {Object.entries(inventory).map(([code, v]) => (
                <tr key={code}>
                  <td>{catalog[code].name}</td>
                  <td className="num">{v.on_hand}</td>
                  <td className="num muted">{v.reserved}</td>
                  <td className="num">
                    <b>{v.on_hand - v.reserved}</b>
                  </td>
                  {plan && !committed && <td className="num">{plan.inventory_after[code]?.on_hand ?? v.on_hand}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">단가 {Object.values(catalog).map((c) => `${c.name} ${won(c.price)}`).join(" · ")}</p>
        </section>
      </div>
    </div>
  );
}
