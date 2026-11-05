import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  Download,
  Loader2,
  PauseCircle,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { api, ApiError, Line, Plan, Question, Run, RunEvent, TERMINAL, won, Workspace } from "./api";

const STEPS: { id: string; label: string; kind: "ai" | "code" | "human" }[] = [
  { id: "prepare", label: "입력 정리·가명화", kind: "code" },
  { id: "intake_1", label: "접수 에이전트 1", kind: "ai" },
  { id: "intake_2", label: "접수 에이전트 2", kind: "ai" },
  { id: "intake_3", label: "접수 에이전트 3", kind: "ai" },
  { id: "finance", label: "정산 에이전트", kind: "ai" },
  { id: "shipping", label: "배송 에이전트", kind: "ai" },
  { id: "plan", label: "계획 엔진", kind: "code" },
  { id: "review", label: "검토 에이전트", kind: "ai" },
  { id: "reintake", label: "재접수", kind: "ai" },
  { id: "questions", label: "사장님 확인", kind: "human" },
  { id: "replan", label: "재계산", kind: "code" },
  { id: "comms", label: "고객응대 에이전트", kind: "ai" },
  { id: "approval", label: "승인", kind: "human" },
  { id: "commit", label: "장부 확정", kind: "code" },
];
const STEP_LABEL = Object.fromEntries(STEPS.map((s) => [s.id, s.label]));

const STATUS_TEXT: Record<string, string> = {
  running: "처리 중",
  waiting_questions: "사장님 확인 대기",
  waiting_approval: "승인 대기",
  completed: "확정 완료",
  rejected: "반려됨",
  conflict: "장부 충돌",
  failed: "실패",
};

export default function Morning({ ws, onCommitted }: { ws: Workspace; onCommitted: () => void }) {
  const [inbox, setInbox] = useState(ws.state.samples.inbox);
  const [deposits, setDeposits] = useState(ws.state.samples.deposits);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const source = useRef<EventSource | null>(null);

  const subscribe = (runId: string) => {
    source.current?.close();
    const es = new EventSource(api.eventsUrl(ws.wsid, runId));
    source.current = es;
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "run") {
        setRun(data.run);
        if (TERMINAL.has(data.run.status)) {
          es.close();
          if (data.run.status === "completed") onCommitted();
        }
      } else if (data.type === "event") {
        setRun((prev) => (prev && !prev.events.some((e) => e.seq === data.event.seq) ? { ...prev, events: [...prev.events, data.event] } : prev));
      }
    };
    es.onerror = () => {
      // 연결이 끊기면 상태를 한 번 다시 읽어 화면을 맞춘다. EventSource가 자동 재연결한다.
      api.run(ws.wsid, runId).then(setRun).catch(() => undefined);
    };
  };

  const attachLatest = async (onlyActive: boolean) => {
    const fresh = await api.workspace(ws.wsid);
    const latest = fresh.runs.find((r) => r.type === "morning" && (!onlyActive || !TERMINAL.has(r.status)));
    if (!latest) return false;
    const r = await api.run(ws.wsid, latest.run_id);
    setRun(r);
    if (!TERMINAL.has(r.status)) subscribe(r.run_id);
    return true;
  };

  useEffect(() => {
    setRun(null);
    attachLatest(false).catch(() => undefined);
    setInbox(ws.state.samples.inbox);
    setDeposits(ws.state.samples.deposits);
    return () => source.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.wsid]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const r = await api.startMorning(ws.wsid, inbox, deposits);
      setRun(r);
      subscribe(r.run_id);
    } catch (e) {
      // 이미 진행 중인 실행이 있으면 새로 만들지 않고 그 실행에 다시 연결한다.
      if (e instanceof ApiError && e.status === 409 && (await attachLatest(true).catch(() => false))) return;
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const respond = async (body: { answers?: Record<string, string>; decision?: string }) => {
    if (!run?.pending) return;
    setError(null);
    try {
      const r = await api.respond(ws.wsid, run.run_id, { request_id: run.pending.request_id, ...body });
      setRun(r);
      subscribe(r.run_id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const active = run && !TERMINAL.has(run.status);
  const plan = run?.pending?.data.plan ?? run?.plan ?? null;

  return (
    <div className="morning">
      <section className="panel input-panel" aria-labelledby="input-title">
        <div className="panel-head">
          <h2 id="input-title">오늘 아침 들어온 자료</h2>
          <span className="muted small">카카오톡 대화 내보내기와 은행 입금 알림 문자를 붙여넣습니다. 예제가 미리 채워져 있습니다.</span>
        </div>
        <div className="inputs">
          <label>
            <span>카카오톡 주문방 대화</span>
            <textarea value={inbox} onChange={(e) => setInbox(e.target.value)} rows={12} spellCheck={false} disabled={!!active} />
          </label>
          <label>
            <span>입금 알림 문자</span>
            <textarea value={deposits} onChange={(e) => setDeposits(e.target.value)} rows={12} spellCheck={false} disabled={!!active} />
          </label>
        </div>
        <div className="input-foot">
          <div className="stock" aria-label="현재 재고">
            {Object.entries(ws.state.inventory).map(([code, v]) => (
              <span key={code} className="chip">
                {ws.state.catalog[code].name} <b className="num">{v.on_hand}</b>박스
                {v.reserved ? <span className="muted"> (확보 {v.reserved})</span> : null}
              </span>
            ))}
          </div>
          <button className="primary" onClick={start} disabled={!!active || starting}>
            {starting || active ? <Loader2 className="spin" size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            {active ? "처리 중" : run ? "다시 처리" : "아침 업무 처리"}
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {run && <Progress run={run} />}

      {run?.status === "waiting_questions" && run.pending?.data.questions && (
        <Questions key={run.pending.request_id} questions={run.pending.data.questions} plan={run.pending.data.plan} onSubmit={(answers) => respond({ answers })} />
      )}

      {run?.status === "waiting_approval" && plan && <Approval key={run.pending?.request_id} plan={plan} onDecide={(decision) => respond({ decision })} />}

      {run && TERMINAL.has(run.status) && <Outcome run={run} wsid={ws.wsid} plan={plan} />}
    </div>
  );
}

function stepState(events: RunEvent[], step: string) {
  const mine = events.filter((e) => e.step === step);
  if (!mine.length) return { status: "idle", text: "" };
  const running = new Set<string>();
  let last = mine[mine.length - 1];
  for (const e of mine) {
    if (e.status === "running") running.add(e.text ?? "");
  }
  const doneCount = mine.filter((e) => e.status === "done" || e.status === "failed").length;
  const runningCount = mine.filter((e) => e.status === "running").length;
  const status = runningCount > doneCount ? "running" : last.status ?? "done";
  return { status, text: last.text ?? "" };
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="spin" size={16} aria-label="처리 중" />;
  if (status === "done") return <CheckCircle2 size={16} className="ok" aria-label="완료" />;
  if (status === "failed") return <XCircle size={16} className="bad" aria-label="실패" />;
  if (status === "waiting") return <PauseCircle size={16} className="wait" aria-label="대기" />;
  return <CircleDashed size={16} className="idle" aria-label="대기 전" />;
}

function Progress({ run }: { run: Run }) {
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run.events.length]);
  const visible = STEPS.filter((s) => s.id !== "reintake" || run.events.some((e) => e.step === "reintake"));
  return (
    <section className="panel" aria-labelledby="progress-title" aria-live="polite">
      <div className="panel-head">
        <h2 id="progress-title">에이전트 팀 진행 상황</h2>
        <span className={`badge status-${run.status}`}>{STATUS_TEXT[run.status] ?? run.status}</span>
      </div>
      <div className="progress">
        <ul className="board">
          {visible.map((s) => {
            const st = stepState(run.events, s.id);
            return (
              <li key={s.id} className={`board-item ${st.status}`}>
                <StatusIcon status={st.status} />
                <span className="board-label">
                  {s.label}
                  <span className={`kind ${s.kind}`}>{s.kind === "ai" ? "AI" : s.kind === "code" ? "코드" : "사람"}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <ol className="log" ref={logRef}>
          {run.events
            .filter((e) => e.text)
            .map((e) => (
              <li key={e.seq} className={e.status}>
                <span className="log-step">{STEP_LABEL[e.step ?? ""] ?? "상태"}</span>
                <span>{e.text}</span>
              </li>
            ))}
        </ol>
      </div>
      {run.error && (
        <p className="error" role="alert">
          {run.error}
        </p>
      )}
    </section>
  );
}

function Evidence({ items }: { items: { id: string; at: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="evidence">
      {items.map((e) => (
        <li key={e.id}>
          <span className="muted num">{e.at ? e.at.slice(11, 16) : e.id}</span> {e.text}
        </li>
      ))}
    </ul>
  );
}

function Questions({ questions, plan, onSubmit }: { questions: Question[]; plan: Plan; onSubmit: (a: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, (q.options.find((o) => o.recommended) ?? q.options[0]).value])),
  );
  const [sending, setSending] = useState(false);
  return (
    <section className="panel" aria-labelledby="q-title">
      <div className="panel-head">
        <h2 id="q-title">확인이 필요한 {questions.length}건</h2>
        <span className="muted small">
          나머지 {plan.lines.length}개 주문 줄은 정책대로 처리했습니다. 추천 답이 미리 선택되어 있으니 바꿀 항목만 고르세요.
        </span>
      </div>
      <div className="questions">
        {questions.map((q) => (
          <fieldset key={q.id} className="question">
            <legend>
              <Bot size={16} aria-hidden className="ai-ico" /> {q.title}
            </legend>
            <p>{q.detail}</p>
            <Evidence items={q.evidence} />
            <div className="options" role="radiogroup" aria-label={q.title}>
              {q.options.map((o) => (
                <label key={o.value} className={answers[q.id] === o.value ? "option selected" : "option"}>
                  <input type="radio" name={q.id} value={o.value} checked={answers[q.id] === o.value} onChange={() => setAnswers({ ...answers, [q.id]: o.value })} />
                  {o.label}
                  {o.recommended && <span className="rec">추천</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={sending}
          onClick={() => {
            setSending(true);
            onSubmit(answers);
          }}
        >
          {sending ? <Loader2 className="spin" size={18} aria-hidden /> : <Check size={18} aria-hidden />} 답변 반영하고 다시 계산
        </button>
      </div>
    </section>
  );
}

function LineRow({ line, messages }: { line: Line; messages: Plan["messages"] }) {
  const [open, setOpen] = useState(false);
  const ev = messages.filter((m) => line.source_ids.includes(m.id));
  return (
    <>
      <tr>
        <td>{line.customer}</td>
        <td>
          {line.recipient}
          <div className="muted small">{line.address ?? (line.address_raw ? `${line.address_raw} (불완전)` : "주소 없음")}</div>
        </td>
        <td>{line.product_name}</td>
        <td className="num">{line.qty}</td>
        <td className="num">{won(line.amount)}</td>
        <td>
          <span className={`status st-${line.status}`}>{line.status_label}</span>
          {line.ship_date && <div className="muted small num">{line.ship_date.slice(5)}</div>}
        </td>
        <td>
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Bot size={14} aria-hidden /> 근거 {ev.length}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={7}>
            {line.history && (
              <p>
                <span className="ai-tag">AI 해석</span> {line.history}
              </p>
            )}
            <Evidence items={ev} />
          </td>
        </tr>
      )}
    </>
  );
}

function Approval({ plan, onDecide }: { plan: Plan; onDecide: (d: "approve" | "reject") => void }) {
  const [sending, setSending] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const confirmedDeposits = plan.deposits.filter((d) => d.confirmed);
  const refundTotal = plan.refunds.reduce((a, r) => a + r.amount, 0);
  const decide = (d: "approve" | "reject") => {
    setSending(d);
    onDecide(d);
  };
  const products = useMemo(() => Object.keys(plan.inventory_before), [plan]);
  return (
    <section className="panel approval" aria-labelledby="a-title">
      <div className="panel-head">
        <h2 id="a-title">출고안 승인</h2>
        <span className="muted small">승인하기 전까지 장부와 재고는 바뀌지 않습니다. AI 해석에는 근거 메시지가 붙어 있습니다.</span>
      </div>

      <dl className="summary">
        <div>
          <dt>오늘 출고</dt>
          <dd className="num">
            {plan.counts.ship_today_parcels}건 · {plan.counts.ship_today_boxes}박스
          </dd>
        </div>
        <div>
          <dt>확인된 입금</dt>
          <dd className="num">
            {confirmedDeposits.length}/{plan.deposits.length}건 · {won(confirmedDeposits.reduce((a, d) => a + d.amount, 0))}
          </dd>
        </div>
        <div>
          <dt>환불 예정</dt>
          <dd className="num">{refundTotal ? won(refundTotal) : "없음"}</dd>
        </div>
        <div>
          <dt>재고 변화</dt>
          <dd className="num">
            {products.map((p) => (
              <span key={p} className="inv">
                {p} {plan.inventory_before[p].on_hand}→{plan.inventory_after[p].on_hand}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      {(plan.flags.length > 0 || plan.shortages.length > 0 || (plan.review?.findings.length ?? 0) > 0) && (
        <ul className="alerts">
          {plan.flags.map((f, i) => (
            <li key={`f${i}`} className="alert security">
              <ShieldAlert size={16} aria-hidden /> {f.customer}님 메시지 속 지시문을 업무 데이터로만 처리했습니다: {f.text}
            </li>
          ))}
          {plan.shortages.map((s) => (
            <li key={s.product} className="alert warn">
              <AlertTriangle size={16} aria-hidden /> {s.product_name} {s.qty}박스 재고 부족. 대안: {s.alternatives.join(", ")}
            </li>
          ))}
          {plan.review?.findings.map((f, i) => (
            <li key={`r${i}`} className="alert info">
              <Bot size={16} aria-hidden /> 검토 에이전트({f.severity === "critical" ? "중대" : "경미"}): {f.customer} — {f.issue}
            </li>
          ))}
        </ul>
      )}

      <div className="table-wrap">
        <table>
          <caption className="sr-only">주문 줄별 처리 결과</caption>
          <thead>
            <tr>
              <th>주문자</th>
              <th>받는 분</th>
              <th>상품</th>
              <th className="num">수량</th>
              <th className="num">금액</th>
              <th>상태</th>
              <th>근거</th>
            </tr>
          </thead>
          <tbody>
            {plan.lines.map((l) => (
              <LineRow key={l.line_id} line={l} messages={plan.messages} />
            ))}
          </tbody>
        </table>
      </div>

      <h3>입금 대조</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>입금</th>
              <th className="num">금액</th>
              <th>연결</th>
              <th>근거</th>
            </tr>
          </thead>
          <tbody>
            {plan.deposits.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.payer} <span className="muted small num">{d.at.slice(5).replace("T", " ")}</span>
                </td>
                <td className="num">{won(d.amount)}</td>
                <td>{d.confirmed ? <span className="status st-ship_today">{d.customer}</span> : <span className="status st-hold">{d.customer ? `${d.customer}(미확정)` : "미연결"}</span>}</td>
                <td className="small">
                  {d.by === "ai" && <span className="ai-tag">AI 제안</span>} {d.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.cancellations.length > 0 && (
        <p className="muted small">
          취소 반영: {plan.cancellations.map((c) => `${c.customer} ${c.product} ${c.qty}개`).join(", ")}
        </p>
      )}

      {plan.drafts && plan.drafts.length > 0 && (
        <>
          <h3>고객에게 보낼 메시지 초안</h3>
          <p className="muted small">자동으로 보내지 않습니다. 복사해서 카카오톡으로 직접 보내세요. 메시지 속 금액은 코드 계산값과 대조했습니다.</p>
          <div className="drafts">
            {plan.drafts.map((d) => (
              <article key={d.customer} className="draft">
                <header>
                  <b>{d.customer}</b>
                  <span className="ai-tag">AI 작성</span>
                  {d.amount_check === "ok" ? (
                    <span className="check ok">
                      <Check size={14} aria-hidden /> 금액 일치
                    </span>
                  ) : (
                    <span className="check bad">
                      <AlertTriangle size={14} aria-hidden /> 확인 필요: {d.unknown_amounts.map(won).join(", ")}
                    </span>
                  )}
                  <button
                    className="link"
                    onClick={() => {
                      navigator.clipboard.writeText(d.text);
                      setCopied(d.customer);
                    }}
                  >
                    <ClipboardCopy size={14} aria-hidden /> {copied === d.customer ? "복사됨" : "복사"}
                  </button>
                </header>
                <p>{d.text}</p>
              </article>
            ))}
          </div>
        </>
      )}

      <div className="actions sticky">
        <button className="ghost" disabled={!!sending} onClick={() => decide("reject")}>
          반려
        </button>
        <button className="primary" disabled={!!sending} onClick={() => decide("approve")}>
          {sending === "approve" ? <Loader2 className="spin" size={18} aria-hidden /> : <Check size={18} aria-hidden />} 승인하고 장부 확정
        </button>
      </div>
    </section>
  );
}

function Outcome({ run, wsid, plan }: { run: Run; wsid: string; plan: Plan | null }) {
  if (run.status === "completed") {
    const s = run.result?.summary ?? {};
    return (
      <section className="panel outcome ok" aria-labelledby="o-title">
        <h2 id="o-title">
          <CheckCircle2 aria-hidden /> 장부 확정 완료
        </h2>
        <p>
          주문 {s.orders}줄, 오늘 출고 {s.shipped_boxes}박스, 입금 연결 {s.payments}건{s.refunds ? `, 환불 예정 ${won(s.refunds)}` : ""}을 반영했습니다.
          {run.result?.status === "duplicate" && " (같은 승인이 다시 들어와 추가 반영 없이 기존 결과를 돌려주었습니다.)"}
        </p>
        <div className="actions left">
          <a className="button primary" href={`/api/workspaces/${wsid}/exports/courier.csv`}>
            <Download size={18} aria-hidden /> 택배 일괄접수 CSV
          </a>
          <a className="button ghost" href={`/api/workspaces/${wsid}/exports/packing.csv`}>
            <Download size={18} aria-hidden /> 포장 지시서
          </a>
        </div>
        {plan?.drafts && plan.drafts.length > 0 && <p className="muted small">고객 메시지 초안 {plan.drafts.length}통은 승인 화면에서 복사할 수 있었습니다. 장부 탭에서 확정 결과를, 정답 대조 탭에서 정확도를 확인하세요.</p>}
      </section>
    );
  }
  const text: Record<string, string> = {
    rejected: "출고안을 반려했습니다. 장부는 바뀌지 않았습니다.",
    conflict: "승인하기 전에 장부가 바뀌어 확정하지 않았습니다. 최신 장부로 다시 처리해 주세요.",
    failed: "처리 중 오류가 발생했습니다. 입력을 확인한 뒤 다시 처리해 주세요. 장부는 바뀌지 않았습니다.",
  };
  return (
    <section className="panel outcome bad" role="alert">
      <h2>
        <AlertTriangle aria-hidden /> {STATUS_TEXT[run.status]}
      </h2>
      <p>{text[run.status] ?? run.error}</p>
      {run.error && <p className="muted small">{run.error}</p>}
    </section>
  );
}
