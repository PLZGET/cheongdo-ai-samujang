import { RefreshCw } from "lucide-react";
import { won, Workspace } from "./api";

export default function Ledger({ ws, onRefresh }: { ws: Workspace; onRefresh: () => void }) {
  const { ledger, inventory, catalog } = ws.state;
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="inv-title">
        <div className="panel-head">
          <h2 id="inv-title">재고</h2>
          <button className="ghost" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden /> 새로고침
          </button>
        </div>
        <div className="stock">
          {Object.entries(inventory).map(([code, v]) => (
            <span key={code} className="chip">
              {catalog[code].name} 보유 <b className="num">{v.on_hand}</b> · 확보 <b className="num">{v.reserved}</b>
            </span>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="orders-title">
        <h2 id="orders-title">확정 주문 {ledger.orders.length}줄</h2>
        {ledger.orders.length === 0 ? (
          <p className="muted">아직 확정된 주문이 없습니다. 아침 업무를 처리하고 승인하면 여기에 기록됩니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문번호</th>
                  <th>주문자</th>
                  <th>받는 분</th>
                  <th>상품</th>
                  <th className="num">수량</th>
                  <th className="num">금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {ledger.orders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="num">{o.order_id}</td>
                    <td>{o.customer}</td>
                    <td>{o.recipient}</td>
                    <td>{o.product_name}</td>
                    <td className="num">{o.qty}</td>
                    <td className="num">{won(o.amount)}</td>
                    <td>
                      <span className={`status st-${o.status}`}>{o.status_label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="two-col">
        <section className="panel" aria-labelledby="pay-title">
          <h2 id="pay-title">입금 {ledger.payments.length}건</h2>
          <ul className="plain-list">
            {ledger.payments.map((p) => (
              <li key={p.deposit_id}>
                {p.payer} → {p.customer} <span className="num">{won(p.amount)}</span>
                {p.matched_by === "ai" && <span className="ai-tag">AI 제안·승인</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel" aria-labelledby="ship-title">
          <h2 id="ship-title">출고 {ledger.shipments.length}건</h2>
          <ul className="plain-list">
            {ledger.shipments.map((s) => (
              <li key={s.shipment_id}>
                {s.recipient} · {s.product_name} {s.qty}박스 <span className="muted">{s.tracking ?? "송장 대기"}</span>
              </li>
            ))}
          </ul>
          {ledger.refunds.length > 0 && (
            <>
              <h3>환불 예정</h3>
              <ul className="plain-list">
                {ledger.refunds.map((r, i) => (
                  <li key={i}>
                    {r.customer} <span className="num">{won(r.amount)}</span> <span className="muted">{r.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
