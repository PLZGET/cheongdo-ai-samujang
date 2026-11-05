import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Download,
  Inbox,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Line, Plan, Question, Workspace, won } from "./api";
import { Group, View, clock, countInputs, groupPlan, shortDate } from "./model";
import { MorningRun } from "./useMorningRun";
import { AiTag, EmptyState, ErrorNote, Evidence, LineChip, MessageList, Metric, PageHeader, PayChip, RichText, RunBadge, RunStrip, SearchBox, Segments } from "./ui";

type Seg = "all" | "attention" | "today" | "waiting";
export type Inputs = { inbox: string; deposits: string };

export default function Orders({
  ws,
  morning,
  inputs,
  setInputs,
  onNavigate,
}: {
  ws: Workspace;
  morning: MorningRun;
  inputs: Inputs;
  setInputs: (i: Inputs) => void;
  onNavigate: (v: View) => void;
}) {
  const { run, plan, active } = morning;
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<Seg>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [editing, setEditing] = useState(false);

  const groups = useMemo(() => (plan ? groupPlan(plan) : []), [plan]);
  const counts = useMemo(
    () => ({
      all: groups.length,
      attention: groups.filter((g) => g.attention).length,
      today: groups.filter((g) => g.shipToday).length,
      waiting: groups.filter((g) => g.waiting).length,
    }),
    [groups],
  );
  const visible = useMemo(() => {
    const q = query.trim();
    return groups.filter((g) => {
      if (seg === "attention" && !g.attention) return false;
      if (seg === "today" && !g.shipToday) return false;
      if (seg === "waiting" && !g.waiting) return false;
      if (!q) return true;
      const hay = [g.customer, ...g.lines.flatMap((l) => [l.recipient, l.address ?? "", l.address_raw ?? "", l.product_name])].join(" ");
      return hay.includes(q);
    });
  }, [groups, seg, query]);

  // 선택이 비었거나 목록에서 사라지면 확인이 필요한 고객부터 고른다.
  useEffect(() => {
    if (!groups.length) {
      setSelected(null);
      return;
    }
    if (selected && groups.some((g) => g.customer === selected)) return;
    setSelected((groups.find((g) => g.attention) ?? groups[0]).customer);
  }, [groups, selected]);

  useEffect(() => {
    if (run && !active) setEditing(false);
  }, [run, active]);

  const current = groups.find((g) => g.customer === selected) ?? null;
  const inputCount = countInputs(inputs.inbox, inputs.deposits);
  const questionsTotal = run?.status === "waiting_questions" ? run.pending?.data.questions?.length ?? 0 : 0;
  const start = async () => {
    setEditing(false);
    await morning.start(inputs.inbox, inputs.deposits);
  };

  const meta = plan ? (
    <>
      <RunBadge run={run} />
      <span>
        고객 {plan.counts.customers}명 · 주문 줄 {plan.lines.filter((l) => l.status !== "cancelled").length} · 오늘 출고 {plan.counts.ship_today_parcels}건 {plan.counts.ship_today_boxes}박스
      </span>
    </>
  ) : (
    <>
      <RunBadge run={run} />
      <span>
        메시지 {inputCount.messages}건 · 입금 문자 {inputCount.deposits}건 · 기준일 {shortDate(ws.state.business_date)}
      </span>
    </>
  );

  return (
    <div className="page orders">
      <PageHeader
        title="주문"
        meta={meta}
        tools={
          plan && (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="고객·받는 분·주소·상품 검색" />
              <Segments
                label="주문 묶음 필터"
                value={seg}
                onChange={setSeg}
                items={[
                  { id: "all", label: "전체", count: counts.all },
                  { id: "attention", label: "확인 필요", count: counts.attention },
                  { id: "today", label: "오늘 출고", count: counts.today },
                  { id: "waiting", label: "대기", count: counts.waiting },
                ]}
              />
            </>
          )
        }
      >
        <PrimaryAction morning={morning} wsid={ws.wsid} questions={questionsTotal} onStart={start} onNavigate={onNavigate} />
      </PageHeader>

      <div className="page-body">
        <ErrorNote message={morning.error} onDismiss={morning.dismissError} />

        <section className={editing ? "inputcard open" : "inputcard"} aria-label="입력 자료">
          <div className="inputcard-row">
            <Inbox size={16} aria-hidden className="muted" />
            <b>입력 자료</b>
            <span className="muted">
              카카오톡 대화 {inputCount.messages}건 · 입금 문자 {inputCount.deposits}건
              {inputs.inbox === ws.state.samples.inbox && inputs.deposits === ws.state.samples.deposits ? " · 예제 자료" : " · 수정됨"}
            </span>
            <button type="button" className="btn ghost sm" aria-expanded={editing} onClick={() => setEditing(!editing)} disabled={active}>
              <Pencil size={13} aria-hidden /> {editing ? "접기" : "자료 편집"}
            </button>
          </div>
          {editing && (
            <div className="inputs">
              <label>
                <span>카카오톡 주문방 대화 내보내기</span>
                <textarea value={inputs.inbox} onChange={(e) => setInputs({ ...inputs, inbox: e.target.value })} rows={10} spellCheck={false} disabled={active} />
              </label>
              <label>
                <span>은행 입금 알림 문자</span>
                <textarea value={inputs.deposits} onChange={(e) => setInputs({ ...inputs, deposits: e.target.value })} rows={10} spellCheck={false} disabled={active} />
              </label>
              <div className="inputs-foot">
                <button type="button" className="btn ghost sm" onClick={() => setInputs({ inbox: ws.state.samples.inbox, deposits: ws.state.samples.deposits })} disabled={active}>
                  예제로 되돌리기
                </button>
                {run && !active && (
                  <button type="button" className="btn primary sm" onClick={start} disabled={morning.starting}>
                    <Play size={14} aria-hidden /> 이 자료로 다시 처리
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {run && <RunStrip run={run} defaultOpen={run.status === "running"} />}

        {run && run.status === "completed" && <Completed run={run} wsid={ws.wsid} onNavigate={onNavigate} />}
        {run && (run.status === "rejected" || run.status === "conflict" || run.status === "failed") && (
          <div className="note danger" role="alert">
            <XCircle size={16} aria-hidden />
            <span>
              {run.status === "rejected" && "출고안을 반려했습니다. 장부는 바뀌지 않았습니다."}
              {run.status === "conflict" && "승인하기 전에 장부가 바뀌어 확정하지 않았습니다. 최신 장부로 다시 처리해 주세요."}
              {run.status === "failed" && `처리 중 오류가 발생했습니다. 장부는 바뀌지 않았습니다.${run.error ? ` (${run.error})` : ""}`}
            </span>
          </div>
        )}

        {plan && <PlanSummary plan={plan} catalog={ws.state.catalog} done={run?.status === "completed"} />}

        {plan ? (
          <div className={mobileDetail ? "split detail-open" : "split"}>
            <OrderList groups={visible} selected={selected} onSelect={(c) => {
              setSelected(c);
              setMobileDetail(true);
            }} total={groups.length} />
            <div className="detail">
              {current ? (
                <Detail group={current} plan={plan} morning={morning} onBack={() => setMobileDetail(false)} />
              ) : (
                <EmptyState title="고객을 선택하세요" detail="왼쪽 목록에서 고객을 고르면 원문 메시지, 주문 줄, 입금, 배송 정보를 볼 수 있습니다." />
              )}
            </div>
          </div>
        ) : (
          <PreRun ws={ws} inputs={inputs} running={active || morning.starting} />
        )}
      </div>
    </div>
  );
}

function PrimaryAction({ morning, wsid, questions, onStart, onNavigate }: { morning: MorningRun; wsid: string; questions: number; onStart: () => void; onNavigate: (v: View) => void }) {
  const { run, active, starting, sending } = morning;
  if (!run || run.status === "rejected" || run.status === "conflict" || run.status === "failed") {
    return (
      <button type="button" className="btn primary" onClick={onStart} disabled={starting || active}>
        {starting ? <Loader2 size={16} className="spin" aria-hidden /> : <Play size={16} aria-hidden />}
        {run ? "다시 처리" : "아침 업무 처리"}
      </button>
    );
  }
  if (run.status === "running") {
    return (
      <button type="button" className="btn primary" disabled>
        <Loader2 size={16} className="spin" aria-hidden /> 처리 중
      </button>
    );
  }
  if (run.status === "waiting_questions") {
    return (
      <button type="button" className="btn primary" onClick={morning.submitAnswers} disabled={!!sending}>
        {sending === "answers" ? <Loader2 size={16} className="spin" aria-hidden /> : <Check size={16} aria-hidden />}
        답변 {questions}건 반영하고 다시 계산
      </button>
    );
  }
  if (run.status === "waiting_approval") {
    return (
      <>
        <button type="button" className="btn ghost" onClick={() => morning.decide("reject")} disabled={!!sending}>
          {sending === "reject" ? <Loader2 size={16} className="spin" aria-hidden /> : null} 반려
        </button>
        <button type="button" className="btn primary" onClick={() => morning.decide("approve")} disabled={!!sending}>
          {sending === "approve" ? <Loader2 size={16} className="spin" aria-hidden /> : <Check size={16} aria-hidden />}
          승인하고 장부 확정
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => onNavigate("shipments")}>
        출고 화면
      </button>
      <a className="btn primary" href={`/api/workspaces/${wsid}/exports/courier.csv`}>
        <Download size={16} aria-hidden /> 택배 일괄접수 CSV
      </a>
    </>
  );
}

function Completed({ run, wsid, onNavigate }: { run: NonNullable<MorningRun["run"]>; wsid: string; onNavigate: (v: View) => void }) {
  const s = run.result?.summary ?? {};
  return (
    <div className="note ok" role="status">
      <CheckCircle2 size={16} aria-hidden />
      <span>
        <b>장부 확정 완료.</b> 주문 {s.orders}줄, 오늘 출고 {s.shipped_boxes}박스, 입금 연결 {s.payments}건{s.refunds ? `, 환불 예정 ${won(s.refunds)}` : ""}을 반영했습니다.
        {run.result?.status === "duplicate" && " 같은 승인이 다시 들어와 추가 반영 없이 기존 결과를 돌려주었습니다."}
      </span>
      <span className="note-actions">
        <a className="link" href={`/api/workspaces/${wsid}/exports/packing.csv`}>
          <Download size={13} aria-hidden /> 포장 지시서
        </a>
        <button type="button" className="link" onClick={() => onNavigate("ledger")}>
          장부 보기
        </button>
        <button type="button" className="link" onClick={() => onNavigate("evaluation")}>
          정답 대조
        </button>
      </span>
    </div>
  );
}

function PlanSummary({ plan, catalog, done }: { plan: Plan; catalog: Workspace["state"]["catalog"]; done: boolean }) {
  const confirmed = plan.deposits.filter((d) => d.confirmed);
  const refund = plan.refunds.reduce((a, r) => a + r.amount, 0);
  const products = Object.keys(plan.inventory_before);
  return (
    <>
      <div className="metrics">
        <Metric label="오늘 출고" value={`${plan.counts.ship_today_parcels}건 · ${plan.counts.ship_today_boxes}박스`} />
        <Metric label="연결된 입금" value={`${confirmed.length}/${plan.deposits.length}건`} sub={won(confirmed.reduce((a, d) => a + d.amount, 0))} />
        <Metric label="환불 예정" value={refund ? won(refund) : "없음"} tone={refund ? "warn" : undefined} />
        <Metric
          label={done ? "재고 변화" : "승인 후 재고"}
          value={products.map((p) => (
            <span key={p} className="inv">
              {catalog[p]?.name ?? p} {plan.inventory_before[p].on_hand}→{plan.inventory_after[p].on_hand}
            </span>
          ))}
          sub={plan.shortages.length ? <span className="bad">부족 {plan.shortages.map((s) => `${s.product_name} ${s.qty}박스`).join(", ")}</span> : "부족 없음"}
        />
      </div>
      {plan.shortages.map((s) => (
        <div key={s.product} className="note warn">
          <AlertTriangle size={16} aria-hidden />
          <span>
            {s.product_name} {s.qty}박스가 재고보다 많습니다. 입금 완료 순 → 단골 순으로 배정했고, 못 받는 고객에게는 대안({s.alternatives.join(", ")})을 안내하는 초안을 {done ? "만들었습니다" : "만듭니다"}.
          </span>
        </div>
      ))}
    </>
  );
}

function regionShort(line: Line) {
  const a = line.address ?? line.address_raw ?? "";
  const m = a.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\s]*\s*([^\s]*)/);
  if (!m) return a ? a.split(" ").slice(0, 2).join(" ") : "주소 없음";
  return `${m[1]} ${m[2] ?? ""}`.trim();
}

function OrderList({ groups, selected, onSelect, total }: { groups: Group[]; selected: string | null; onSelect: (c: string) => void; total: number }) {
  if (!groups.length) {
    return (
      <div className="list">
        <EmptyState title={total ? "조건에 맞는 고객이 없습니다" : "정리된 주문이 없습니다"} detail={total ? "검색어나 필터를 바꿔 보세요." : undefined} />
      </div>
    );
  }
  return (
    <ul className="list" aria-label="고객별 주문">
      {groups.map((g) => {
        const on = g.customer === selected;
        return (
          <li key={g.customer}>
            <button type="button" className={on ? "card on" : "card"} aria-pressed={on} onClick={() => onSelect(g.customer)}>
              <div className="card-head">
                <b>{g.customer}</b>
                {g.payment && g.payment.total > 0 && <PayChip status={g.payment.status} />}
                {g.amount > 0 && <span className="num amount">{won(g.amount)}</span>}
              </div>
              {g.lines.length ? (
                <ul className="card-lines">
                  {g.lines.map((l) => (
                    <li key={l.line_id} className={l.status === "cancelled" ? "cancelled" : undefined}>
                      <span className="pl">
                        {l.product_name} <b className="num">×{l.qty}</b>
                      </span>
                      <span className="rc muted">
                        {l.recipient !== g.customer ? `${l.recipient} · ` : ""}
                        {regionShort(l)}
                      </span>
                      <LineChip status={l.status} label={l.status_label} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small card-note">{g.inquiries[0]?.text ?? g.questions[0]?.title ?? "주문 줄 없음"}</p>
              )}
              {(g.questions.length > 0 || g.flags.length > 0 || g.findings.length > 0 || g.inquiries.length > 0) && (
                <div className="card-foot">
                  {g.questions.length > 0 && (
                    <span className="mark warn">
                      <Bot size={11} aria-hidden /> 확인 질문 {g.questions.length}
                    </span>
                  )}
                  {g.flags.length > 0 && (
                    <span className="mark danger">
                      <ShieldAlert size={11} aria-hidden /> 지시문 감지
                    </span>
                  )}
                  {g.findings.length > 0 && (
                    <span className="mark info">
                      <Bot size={11} aria-hidden /> 검토 지적 {g.findings.length}
                    </span>
                  )}
                  {g.inquiries.length > 0 && !g.lines.length && (
                    <span className="mark muted">
                      <MessageSquare size={11} aria-hidden /> 문의
                    </span>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ group: g, plan, morning, onBack }: { group: Group; plan: Plan; morning: MorningRun; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const asking = morning.run?.status === "waiting_questions";
  const pay = g.payment;
  const showPay = pay && (pay.total > 0 || pay.paid > 0);
  return (
    <article className="detail-inner" aria-label={`${g.customer} 상세`}>
      <header className="detail-head">
        <button type="button" className="icon-btn back" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} aria-hidden />
        </button>
        <div>
          <h2>{g.customer}</h2>
          <div className="detail-sub">
            {showPay && <PayChip status={pay.status} />}
            {showPay && (
              <span className="num muted">
                주문 {won(pay.total)} · 입금 {won(pay.paid)}
                {pay.balance > 0 ? ` · 잔액 ${won(pay.balance)}` : pay.balance < 0 ? ` · 초과 ${won(-pay.balance)}` : ""}
              </span>
            )}
          </div>
        </div>
      </header>

      {asking && g.questions.length > 0 && (
        <section className="dsec questions">
          <h3>
            <Bot size={14} aria-hidden className="ai-ico" /> 확인 질문 {g.questions.length}건
          </h3>
          {g.questions.map((q) => (
            <QuestionCard key={q.id} q={q} value={morning.answers[q.id]} onChange={(v) => morning.setAnswer(q.id, v)} />
          ))}
        </section>
      )}

      {g.flags.map((f, i) => (
        <div key={`f${i}`} className="note danger">
          <ShieldAlert size={16} aria-hidden />
          <span>
            메시지 속 지시문을 실행하지 않고 업무 데이터로만 처리했습니다: <q><RichText text={f.text} /></q>
          </span>
        </div>
      ))}
      {g.findings.map((f, i) => (
        <div key={`r${i}`} className={f.severity === "critical" ? "note warn" : "note info"}>
          <Bot size={16} aria-hidden />
          <span>
            검토 에이전트({f.severity === "critical" ? "중대" : "경미"}): {f.issue}
            {f.fix ? ` → ${f.fix}` : ""}
          </span>
        </div>
      ))}

      {g.lines.length > 0 && (
        <section className="dsec">
          <h3>주문 줄 {g.lines.length}</h3>
          <ul className="lines">
            {g.lines.map((l) => (
              <li key={l.line_id} className={l.status === "cancelled" ? "line cancelled" : "line"}>
                <div className="line-top">
                  <b>
                    {l.product_name} <span className="num">×{l.qty}</span>
                  </b>
                  <span className="num">{won(l.amount)}</span>
                  <LineChip status={l.status} label={l.status_label} full />
                </div>
                <dl className="line-kv">
                  <dt>받는 분</dt>
                  <dd>
                    {l.recipient}
                    {l.phone && !/^\[전화\d+\]$/.test(l.phone) ? <span className="muted num"> · {l.phone}</span> : null}
                  </dd>
                  <dt>주소</dt>
                  <dd>{l.address ?? (l.address_raw ? <span className="warn-text">{l.address_raw} (불완전)</span> : <span className="warn-text">주소 없음</span>)}</dd>
                  {(l.ship_date || l.requested_when) && (
                    <>
                      <dt>발송</dt>
                      <dd className="num">
                        {l.ship_date ? shortDate(l.ship_date) : "미정"}
                        {l.requested_when ? <span className="muted"> · 요청 {l.requested_when}</span> : null}
                        {l.region === "jeju" || l.region === "island" ? <span className="muted"> · 도서산간 추가운임</span> : null}
                      </dd>
                    </>
                  )}
                </dl>
                {(l.history || l.from_last_year) && (
                  <p className="ai-note">
                    <AiTag>AI 해석</AiTag> <RichText text={l.history || "작년 주문 기록을 바탕으로 제안"} messages={plan.messages} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {g.cancellations.length > 0 && (
        <section className="dsec">
          <h3>취소 반영</h3>
          <ul className="plain">
            {g.cancellations.map((c, i) => (
              <li key={i}>
                {c.product} {c.qty}개 {c.note && <span className="muted">· {c.note}</span>}
                <Evidence items={c.evidence} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(g.deposits.length > 0 || showPay) && (
        <section className="dsec">
          <h3>입금 대조</h3>
          {g.deposits.length ? (
            <ul className="deps">
              {g.deposits.map((d) => (
                <li key={d.id}>
                  <span className="num">{clock(d.at) ? `${d.at.slice(5, 10)} ${clock(d.at)}` : ""}</span>
                  <span>
                    {d.payer}
                    {d.payer !== g.customer && <span className="muted"> (대리)</span>}
                  </span>
                  <span className="num">{won(d.amount)}</span>
                  <span>{d.confirmed ? <span className="chip pay-paid">연결</span> : <span className="chip pay-partial">미확정</span>}</span>
                  <span className="muted small dep-reason">
                    {d.by === "ai" && <AiTag />}
                    {d.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">연결된 입금이 없습니다.</p>
          )}
          {g.refunds.map((r, i) => (
            <p key={i} className="small">
              환불 예정 <b className="num">{won(r.amount)}</b> <span className="muted">· {r.reason}</span>
            </p>
          ))}
        </section>
      )}

      {(g.inquiries.length > 0 || g.notes.length > 0) && (
        <section className="dsec">
          <h3>문의·메모</h3>
          <ul className="plain">
            {g.inquiries.map((i, k) => (
              <li key={`i${k}`}>
                <MessageSquare size={13} aria-hidden className="muted" /> {i.text}
              </li>
            ))}
            {g.notes.map((n, k) => (
              <li key={`n${k}`} className="muted">
                {n.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dsec">
        <h3>
          원문 메시지 {g.messages.length}
          {g.evidenceCount > 0 && <span className="muted small"> · 근거로 쓰인 메시지 {g.evidenceCount}</span>}
        </h3>
        <MessageList messages={g.messages} evidence={g.evidenceIds} />
      </section>

      {g.draft && (
        <section className="dsec draft">
          <h3>
            고객에게 보낼 메시지 초안
            <AiTag>AI 작성</AiTag>
          </h3>
          <p className="muted small">자동으로 보내지 않습니다. 복사해서 카카오톡으로 직접 보내세요.</p>
          <div className="draft-box">
            <p>{g.draft.text}</p>
            <div className="draft-foot">
              {g.draft.amount_check === "ok" ? (
                <span className="mark ok">
                  <Check size={11} aria-hidden /> 금액 코드 계산값과 일치
                </span>
              ) : (
                <span className="mark danger">
                  <AlertTriangle size={11} aria-hidden /> 계산값에 없는 금액: {g.draft.unknown_amounts.map(won).join(", ")}
                </span>
              )}
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  navigator.clipboard.writeText(g.draft!.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <ClipboardCopy size={13} aria-hidden /> {copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
        </section>
      )}
      <p className="muted small detail-foot">{plan.review ? `검토 ${plan.review.round + 1}회차 기준` : ""}</p>
    </article>
  );
}

function QuestionCard({ q, value, onChange }: { q: Question; value: string | undefined; onChange: (v: string) => void }) {
  const [more, setMore] = useState(false);
  return (
    <fieldset className="question">
      <legend>{q.title}</legend>
      <p>
        <RichText text={q.detail} />
      </p>
      {q.evidence.length > 0 && (
        <>
          <button type="button" className="link" aria-expanded={more} onClick={() => setMore(!more)}>
            근거 {q.evidence.length} <ChevronDown size={13} aria-hidden className={more ? "rot" : ""} />
          </button>
          {more && <Evidence items={q.evidence} />}
        </>
      )}
      <div className="options" role="radiogroup" aria-label={q.title}>
        {q.options.map((o) => (
          <label key={o.value} className={value === o.value ? "option on" : "option"}>
            <input type="radio" name={q.id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
            {o.recommended && <span className="rec">추천</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 실행 전: 들어온 원문을 그대로 보여 주고 오른쪽에 처리 안내를 둔다. */
function PreRun({ ws, inputs, running }: { ws: Workspace; inputs: Inputs; running: boolean }) {
  const feed = useMemo(() => parseKakao(inputs.inbox), [inputs.inbox]);
  const policy = ws.state.policy as { remote_fee_per_box?: number; no_ship_weekdays_perishable?: number[] };
  const blocked = (policy.no_ship_weekdays_perishable ?? []).map((d) => ["월", "화", "수", "목", "금", "토", "일"][d]).join("·");
  return (
    <div className="split prerun">
      <section className="list feed" aria-label="밤사이 들어온 메시지">
        <div className="feed-head">
          <h2>밤사이 들어온 메시지</h2>
          <span className="muted small">{running ? "AI 사무장이 읽는 중" : "처리 전 원문"}</span>
        </div>
        {feed.length ? (
          <ol className="msgs">
            {feed.map((m, i) =>
              m.kind === "day" ? (
                <li key={i} className="msg-day">
                  {m.text}
                </li>
              ) : (
                <li key={i} className="msg">
                  <div className="msg-meta">
                    <b>{m.sender}</b>
                    <span className="num">{m.time}</span>
                  </div>
                  <p>{m.text}</p>
                </li>
              ),
            )}
          </ol>
        ) : (
          <EmptyState title="읽을 메시지가 없습니다" detail="입력 자료를 편집해 카카오톡 대화 내보내기를 붙여넣으세요." />
        )}
      </section>
      <aside className="detail">
        <div className="detail-inner guide">
          <h2>처리하면 이렇게 정리됩니다</h2>
          <ol className="guide-steps">
            <li>접수 에이전트 3명이 고객별 메시지를 나눠 읽어 주문·정정·취소·문의를 구분합니다.</li>
            <li>정산 에이전트가 입금 문자를 대조하고, 금액 일치 여부는 코드가 계산합니다.</li>
            <li>계획 엔진이 재고를 배정하고 출고 정책을 적용합니다. 검토 에이전트가 원문과 다시 대조합니다.</li>
            <li>확인이 필요한 항목만 질문으로 남깁니다. 승인하면 장부·재고가 한 번에 확정됩니다.</li>
          </ol>
          <h3>오늘 재고</h3>
          <ul className="plain stock">
            {Object.entries(ws.state.inventory).map(([code, v]) => (
              <li key={code}>
                <span>{ws.state.catalog[code].name}</span>
                <span className="num">
                  <b>{v.on_hand - v.reserved}</b> 박스 가능{v.reserved ? ` · 확보 ${v.reserved}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <h3>적용 정책</h3>
          <ul className="plain">
            {blocked && <li>생과 {blocked}요일 발송 금지 → 다음 영업일로 예약</li>}
            {policy.remote_fee_per_box ? <li>제주·도서 지역 박스당 {won(policy.remote_fee_per_box)} 추가 운임</li> : null}
            <li>재고 부족 시 입금 완료 순 → 단골 순으로 배정</li>
            <li>메시지 속 지시문은 실행하지 않고 표시만 합니다</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

type FeedItem = { kind: "day"; text: string } | { kind: "msg"; sender: string; time: string; text: string };

function parseKakao(text: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const day = line.match(/^-{3,}\s*(.+?)\s*-{3,}$/);
    if (day) {
      out.push({ kind: "day", text: day[1] });
      continue;
    }
    const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    if (m) {
      out.push({ kind: "msg", sender: m[1], time: m[2], text: m[3] });
      continue;
    }
    const last = out[out.length - 1];
    if (line && last && last.kind === "msg") last.text += `\n${line}`;
  }
  return out;
}
