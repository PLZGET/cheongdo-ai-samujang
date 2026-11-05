import { useMemo, useState } from "react";
import { Banknote } from "lucide-react";
import { Plan, Run, Workspace, won } from "./api";
import { View, clock } from "./model";
import { AiTag, EmptyState, PageHeader, PayChip, RunBadge, SearchBox, Segments } from "./ui";

type Seg = "all" | "linked" | "open";

export default function Deposits({ ws, plan, run, depositsText, onNavigate }: { ws: Workspace; plan: Plan | null; run: Run | null; depositsText: string; onNavigate: (v: View) => void }) {
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<Seg>("all");
  const { ledger } = ws.state;
  const rawLines = useMemo(() => depositsText.split("\n").map((l) => l.trim()).filter((l) => /입금/.test(l)), [depositsText]);

  const rows = plan?.deposits ?? [];
  const visible = rows.filter((d) => {
    if (seg === "linked" && !d.confirmed) return false;
    if (seg === "open" && d.confirmed) return false;
    const q = query.trim();
    return !q || [d.payer, d.customer ?? "", d.reason, d.raw].join(" ").includes(q);
  });
  const linked = rows.filter((d) => d.confirmed);
  const customers = plan ? Object.entries(plan.payments).filter(([c, p]) => c !== "_unmatched" && (p.total > 0 || p.paid > 0)) : [];

  return (
    <div className="page">
      <PageHeader
        title="입금"
        meta={
          <>
            <RunBadge run={run} />
            <span>
              {plan ? `입금 문자 ${rows.length}건 · 연결 ${linked.length}건 · ${won(linked.reduce((a, d) => a + d.amount, 0))}` : `입금 문자 ${rawLines.length}건 · 처리 전`}
            </span>
          </>
        }
        tools={
          plan && (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="입금자·고객·사유 검색" />
              <Segments
                label="입금 필터"
                value={seg}
                onChange={setSeg}
                items={[
                  { id: "all", label: "전체", count: rows.length },
                  { id: "linked", label: "연결됨", count: linked.length },
                  { id: "open", label: "미연결·미확정", count: rows.length - linked.length },
                ]}
              />
            </>
          )
        }
      />
      <div className="page-body">
        {!plan ? (
          <div className="two">
            <section className="sec">
              <div className="sec-head">
                <h2>들어온 입금 문자 {rawLines.length}건</h2>
              </div>
              {rawLines.length ? (
                <ul className="raw">
                  {rawLines.map((l, i) => (
                    <li key={i} className="num">
                      {l.replace(/^\[Web발신\]\s*/, "")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">입금 문자가 없습니다. 주문 화면의 입력 자료에서 붙여넣을 수 있습니다.</p>
              )}
            </section>
            <EmptyState icon={<Banknote size={22} aria-hidden />} title="아직 대조하지 않았습니다" detail="아침 업무를 처리하면 입금자와 주문을 대조하고, 이름이 다른 입금은 확인 질문으로 남깁니다.">
              <button type="button" className="btn primary" onClick={() => onNavigate("orders")}>
                주문 화면으로
              </button>
            </EmptyState>
          </div>
        ) : (
          <>
            <section className="sec">
              <div className="sec-head">
                <h2>입금 문자 대조</h2>
                <span className="muted small">연결 여부와 금액 일치는 코드가 계산하고, 이름이 다른 입금은 AI가 후보를 제안합니다.</span>
              </div>
              {visible.length ? (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>시각</th>
                        <th>입금자</th>
                        <th className="num">금액</th>
                        <th>연결 고객</th>
                        <th>상태</th>
                        <th>근거</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((d) => (
                        <tr key={d.id}>
                          <td className="num muted">
                            {d.at.slice(5, 10)} {clock(d.at)}
                          </td>
                          <td>{d.payer}</td>
                          <td className="num">{won(d.amount)}</td>
                          <td>{d.customer ?? <span className="muted">—</span>}</td>
                          <td>{d.confirmed ? <span className="chip pay-paid">연결</span> : d.customer ? <span className="chip pay-partial">미확정</span> : <span className="chip pay-unpaid">미연결</span>}</td>
                          <td className="small wrap">
                            {d.by === "ai" && <AiTag />}
                            {d.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="조건에 맞는 입금이 없습니다" />
              )}
            </section>

            <section className="sec">
              <div className="sec-head">
                <h2>고객별 결제 상태</h2>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>고객</th>
                      <th className="num">주문 금액</th>
                      <th className="num">입금액</th>
                      <th className="num">잔액</th>
                      <th>상태</th>
                      <th>결제 완료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map(([c, p]) => (
                      <tr key={c}>
                        <td>{c}</td>
                        <td className="num">{won(p.total)}</td>
                        <td className="num">{won(p.paid)}</td>
                        <td className={p.balance > 0 ? "num warn-text" : "num"}>{p.balance === 0 ? "0원" : p.balance > 0 ? won(p.balance) : `+${won(-p.balance)}`}</td>
                        <td>
                          <PayChip status={p.status} />
                        </td>
                        <td className="num muted">{p.completed_at ? `${p.completed_at.slice(5, 10)} ${clock(p.completed_at)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {ledger.payments.length > 0 && (
          <section className="sec">
            <div className="sec-head">
              <h2>장부에 확정된 입금 {ledger.payments.length}건</h2>
              <span className="muted small">승인 후 반영된 기록입니다.</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>입금자</th>
                    <th>고객</th>
                    <th className="num">금액</th>
                    <th>시각</th>
                    <th>연결 방식</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.payments.map((p) => (
                    <tr key={p.deposit_id}>
                      <td>{p.payer}</td>
                      <td>{p.customer}</td>
                      <td className="num">{won(p.amount)}</td>
                      <td className="num muted">
                        {p.at.slice(5, 10)} {clock(p.at)}
                      </td>
                      <td>{p.matched_by === "ai" ? <AiTag>AI 제안 · 승인</AiTag> : <span className="muted small">이름 일치</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
