import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, Target, XCircle } from "lucide-react";
import { api, ApiError, Evaluation, Workspace, won } from "./api";
import { LINE_SHORT, PAY_TEXT, View } from "./model";
import { EmptyState, Metric, PageHeader, Spinner } from "./ui";

export default function EvaluationView({ ws, committed, onNavigate }: { ws: Workspace; committed: boolean; onNavigate: (v: View) => void }) {
  const wsid = ws.wsid;
  const catalog = ws.state.catalog;
  const [data, setData] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!committed) return;
    setData(null);
    setError(null);
    api
      .evaluation(wsid)
      .then(setData)
      .catch((e: Error) => setError(e instanceof ApiError && e.status === 409 ? null : e.message));
  }, [wsid, committed, tick]);

  const total = data ? Object.values(data.summary).reduce((a, s) => ({ matched: a.matched + s.matched, total: a.total + s.total }), { matched: 0, total: 0 }) : null;

  return (
    <div className="page">
      <PageHeader title="정답 대조" meta={<span>{total ? `전체 ${total.matched}/${total.total} 일치` : "합성 예제의 정답 장부와 확정 결과를 비교합니다"}</span>}>
        {committed && (
          <button type="button" className="btn ghost" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw size={15} aria-hidden /> 다시 대조
          </button>
        )}
      </PageHeader>
      <div className="page-body">
        {!committed ? (
          <EmptyState icon={<Target size={22} aria-hidden />} title="확정한 뒤에 대조할 수 있습니다" detail="아침 업무를 처리하고 승인하면 주문 줄·결제 상태·환불·재고를 정답 장부와 비교합니다. 추천 답변을 선택했을 때의 정답입니다.">
            <button type="button" className="btn primary" onClick={() => onNavigate("orders")}>
              주문 화면으로
            </button>
          </EmptyState>
        ) : error ? (
          <EmptyState title="대조 결과를 불러오지 못했습니다" detail={error} />
        ) : !data ? (
          <Spinner />
        ) : (
          <>
            <p className="muted small">{data.note}</p>
            <div className="metrics">
              {Object.entries(data.summary).map(([name, s]) => (
                <Metric key={name} label={name} value={`${s.matched}/${s.total}`} tone={s.matched === s.total ? "ok" : "warn"} />
              ))}
            </div>
            {Object.entries(data.details).map(([name, rows]) => (
              <section key={name} className="sec">
                <div className="sec-head">
                  <h2>{name}</h2>
                  <span className="muted small">
                    {rows.filter((r) => r.match).length}/{rows.length} 일치
                  </span>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl eval">
                    <thead>
                      <tr>
                        <th>결과</th>
                        <th>대상</th>
                        <th>기대값</th>
                        <th>실제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const expected = "expected" in r ? r.expected : r;
                        const actual = "actual" in r ? r.actual : undefined;
                        const row = r as { customer?: string; product?: string; expected?: { customer?: string } };
                        const subject = row.customer ?? row.expected?.customer ?? (row.product ? catalog[row.product]?.name ?? row.product : undefined);
                        return (
                          <tr key={i} className={r.match ? undefined : "miss"}>
                            <td>{r.match ? <CheckCircle2 size={15} className="ok" aria-label="일치" /> : <XCircle size={15} className="bad" aria-label="불일치" />}</td>
                            <td>{subject ?? <span className="muted">—</span>}</td>
                            <td className="wrap">
                              <Pretty value={expected} group={name} catalog={catalog} />
                            </td>
                            <td className="wrap">{actual === undefined ? <span className="muted">{"expected" in r && typeof r.expected === "object" ? (r.match ? "일치" : "없음") : "—"}</span> : <Pretty value={actual} group={name} catalog={catalog} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {data.extra_lines.length > 0 && (
              <section className="sec">
                <div className="sec-head">
                  <h2>정답에 없는 줄 {data.extra_lines.length}</h2>
                </div>
                <ul className="plain">
                  {data.extra_lines.map((l, i) => (
                    <li key={i}>
                      <Pretty value={l} group="주문 줄" catalog={catalog} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const KEY_KO: Record<string, string> = { customer: "고객", product: "상품", qty: "수량", recipient: "받는 분", status: "상태" };

function label(key: string | null, v: unknown, group: string, catalog: Workspace["state"]["catalog"]) {
  if (typeof v === "number") return key === "qty" ? `${v}` : group === "환불" ? won(v) : group === "재고" ? `${v}박스` : String(v);
  const s = String(v);
  if (key === "product" && catalog[s]) return catalog[s].name;
  if (key === "status") return LINE_SHORT[s] ?? s;
  if (key === null && group === "결제 상태") return PAY_TEXT[s] ?? s;
  return s;
}

function Pretty({ value, group, catalog }: { value: unknown; group: string; catalog: Workspace["state"]["catalog"] }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value !== "object") return <span className="num">{label(null, value, group, catalog)}</span>;
  const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !["match", "expected", "actual", "customer"].includes(k));
  return (
    <span className="kv">
      {entries.map(([k, v]) => (
        <span key={k}>
          <span className="muted">{KEY_KO[k] ?? k}</span> {label(k, v, group, catalog)}
        </span>
      ))}
    </span>
  );
}
