import { BookOpen, RefreshCw } from "lucide-react";
import { Workspace, won } from "./api";
import { View, clock, shortDate } from "./model";
import { AiTag, EmptyState, LineChip, Metric, PageHeader } from "./ui";

export default function Ledger({ ws, onRefresh, onNavigate }: { ws: Workspace; onRefresh: () => void; onNavigate: (v: View) => void }) {
  const { ledger, inventory, catalog } = ws.state;
  const live = ledger.orders.filter((o) => o.status !== "cancelled");
  const sales = live.reduce((a, o) => a + o.amount, 0);
  const received = ledger.payments.reduce((a, p) => a + p.amount, 0);
  const refunds = ledger.refunds.reduce((a, r) => a + r.amount, 0);
  const outstanding = Math.max(sales - (received - refunds), 0);

  return (
    <div className="page">
      <PageHeader title="장부" meta={<span>승인으로 확정된 기록만 보입니다 · 주문 {ledger.orders.length}줄 · 입금 {ledger.payments.length}건 · 출고 {ledger.shipments.length}건</span>}>
        <button type="button" className="btn ghost" onClick={onRefresh}>
          <RefreshCw size={15} aria-hidden /> 새로고침
        </button>
      </PageHeader>
      <div className="page-body">
        {ledger.orders.length === 0 ? (
          <EmptyState icon={<BookOpen size={22} aria-hidden />} title="아직 확정된 기록이 없습니다" detail="아침 업무를 처리하고 승인하면 주문·입금·출고·재고가 한 번에 기록됩니다. 승인 전에는 아무것도 바뀌지 않습니다.">
            <button type="button" className="btn primary" onClick={() => onNavigate("orders")}>
              주문 화면으로
            </button>
          </EmptyState>
        ) : (
          <div className="metrics">
            <Metric label="주문 금액 합계" value={won(sales)} sub={`주문 ${live.length}줄`} />
            <Metric label="받은 입금" value={won(received)} sub={`${ledger.payments.length}건`} />
            <Metric label="미수금" value={won(outstanding)} tone={outstanding > 0 ? "warn" : undefined} />
            <Metric label="환불 예정" value={refunds ? won(refunds) : "없음"} tone={refunds ? "warn" : undefined} />
          </div>
        )}

        <section className="sec">
          <div className="sec-head">
            <h2>재고</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">보유</th>
                <th className="num">확보</th>
                <th className="num">출고 가능</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {ledger.orders.length > 0 && (
          <section className="sec">
            <div className="sec-head">
              <h2>확정 주문 {ledger.orders.length}줄</h2>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>주문번호</th>
                    <th>주문자</th>
                    <th>받는 분</th>
                    <th>상품</th>
                    <th className="num">수량</th>
                    <th className="num">금액</th>
                    <th>발송</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.orders.map((o) => (
                    <tr key={o.order_id} className={o.status === "cancelled" ? "cancelled" : undefined}>
                      <td className="num muted">{o.order_id}</td>
                      <td>{o.customer}</td>
                      <td>{o.recipient}</td>
                      <td>{o.product_name}</td>
                      <td className="num">{o.qty}</td>
                      <td className="num">{won(o.amount)}</td>
                      <td className="num muted">{o.ship_date ? shortDate(o.ship_date) : "—"}</td>
                      <td>
                        <LineChip status={o.status} label={o.status_label} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(ledger.payments.length > 0 || ledger.shipments.length > 0) && (
          <div className="two">
            <section className="sec">
              <div className="sec-head">
                <h2>입금 {ledger.payments.length}건</h2>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>입금자</th>
                    <th>고객</th>
                    <th className="num">금액</th>
                    <th>시각</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.payments.map((p) => (
                    <tr key={p.deposit_id}>
                      <td>
                        {p.payer} {p.matched_by === "ai" && <AiTag>AI 제안 · 승인</AiTag>}
                      </td>
                      <td>{p.customer}</td>
                      <td className="num">{won(p.amount)}</td>
                      <td className="num muted">
                        {p.at.slice(5, 10)} {clock(p.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.refunds.length > 0 && (
                <>
                  <h3 className="sub">환불 예정</h3>
                  <ul className="plain">
                    {ledger.refunds.map((r, i) => (
                      <li key={i}>
                        {r.customer} <b className="num">{won(r.amount)}</b> <span className="muted">· {r.reason}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section className="sec">
              <div className="sec-head">
                <h2>출고 {ledger.shipments.length}건</h2>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>받는 분</th>
                    <th>상품</th>
                    <th className="num">수량</th>
                    <th>발송일</th>
                    <th>송장</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.shipments.map((s) => (
                    <tr key={s.shipment_id}>
                      <td>{s.recipient}</td>
                      <td>{s.product_name}</td>
                      <td className="num">{s.qty}</td>
                      <td className="num muted">{shortDate(s.ship_date)}</td>
                      <td className="muted small">{s.tracking ?? "송장 대기"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
