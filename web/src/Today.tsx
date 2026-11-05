import { ArrowRight, Check, Download, Loader2, Play } from "lucide-react";
import { Workspace, won } from "./api";
import { View, currentTask, todayLabel } from "./model";
import { MorningRun } from "./useMorningRun";
import { ErrorNote, Metric, PageHeader, RunStrip, Section } from "./ui";

export default function Today({ ws, morning, onNavigate, onStart }: { ws: Workspace; morning: MorningRun; onNavigate: (v: View) => void; onStart: () => void }) {
  const { run } = morning;
  const task = currentTask(ws, run);
  const { ledger, inventory, catalog } = ws.state;
  const pendingShip = ledger.shipments.filter((s) => !s.tracking);
  const unpaid = Object.values(ledger.orders).filter((o) => o.status === "wait_payment").length;

  return (
    <div className="page">
      <PageHeader title="오늘 업무" meta={<span>{todayLabel(ws.state.business_date)} · {ws.state.farm.name.replace(/\(가상\)$/, "")}</span>} />
      <div className="page-body">
        <ErrorNote message={morning.error} onDismiss={morning.dismissError} />

        <section className={`task ${run?.status ?? "idle"}`} aria-labelledby="task-title">
          <div className="task-text">
            <h2 id="task-title">{task.title}</h2>
            <p>{task.detail}</p>
          </div>
          <div className="task-actions">
            {task.action === "start" || task.action === "retry" ? (
              <button type="button" className="btn primary" onClick={onStart} disabled={morning.starting || morning.active}>
                {morning.starting ? <Loader2 size={16} className="spin" aria-hidden /> : <Play size={16} aria-hidden />}
                {task.action === "retry" ? "다시 처리" : "아침 업무 처리"}
              </button>
            ) : task.action === "download" ? (
              <>
                <a className="btn primary" href={`/api/workspaces/${ws.wsid}/exports/courier.csv`}>
                  <Download size={16} aria-hidden /> 택배 일괄접수 CSV
                </a>
                <button type="button" className="btn ghost" onClick={() => onNavigate("shipments")}>
                  출고 화면 <ArrowRight size={15} aria-hidden />
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => onNavigate(task.view)}>
                {task.action === "answer" ? <Check size={16} aria-hidden /> : null}
                {task.action === "answer" ? "질문에 답하기" : task.action === "approve" ? "출고안 검토" : "진행 보기"}
                <ArrowRight size={15} aria-hidden />
              </button>
            )}
          </div>
        </section>

        <RunStrip run={run} />

        <div className="two">
          <Section title="재고">
            <table className="tbl">
              <thead>
                <tr>
                  <th>상품</th>
                  <th className="num">보유</th>
                  <th className="num">확보</th>
                  <th className="num">출고 가능</th>
                  <th className="num">단가</th>
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
                    <td className="num muted">{won(catalog[code].price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="장부 요약"
            aside={
              <button type="button" className="link" onClick={() => onNavigate("ledger")}>
                장부 보기 <ArrowRight size={13} aria-hidden />
              </button>
            }
          >
            <div className="metrics tight">
              <Metric label="확정 주문" value={`${ledger.orders.length}줄`} />
              <Metric label="연결된 입금" value={`${ledger.payments.length}건`} sub={won(ledger.payments.reduce((a, p) => a + p.amount, 0))} />
              <Metric label="출고 대기" value={`${pendingShip.length}건`} sub={pendingShip.length ? "송장 번호 대기" : undefined} />
              <Metric label="입금 대기 주문" value={`${unpaid}줄`} tone={unpaid ? "warn" : undefined} />
            </div>
            {ledger.orders.length === 0 && <p className="muted small">아직 확정된 기록이 없습니다. 아침 업무를 처리하고 승인하면 여기에 쌓입니다.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
