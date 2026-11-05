import { ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, CircleDashed, Loader2, PauseCircle, Search, X, XCircle } from "lucide-react";
import { Plan, Run } from "./api";
import { LINE_SHORT, PAY_TEXT, RUN_STATUS_TEXT, STEP_LABEL, STEPS, stepStates } from "./model";

export function PageHeader({ title, meta, children, tools }: { title: string; meta?: ReactNode; children?: ReactNode; tools?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {tools && <div className="page-tools">{tools}</div>}
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Search size={15} aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" className="icon-btn" onClick={() => onChange("")} aria-label="검색어 지우기">
          <X size={14} aria-hidden />
        </button>
      )}
    </label>
  );
}

export function Segments<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" aria-pressed={value === it.id} className={value === it.id ? "seg on" : "seg"} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && <span className="seg-count num">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function LineChip({ status, label, full }: { status: string; label?: string; full?: boolean }) {
  return (
    <span className={`chip st-${status}`} title={label}>
      {full ? label ?? LINE_SHORT[status] ?? status : LINE_SHORT[status] ?? label ?? status}
    </span>
  );
}

export function PayChip({ status }: { status: string | undefined }) {
  if (!status) return null;
  return <span className={`chip pay-${status}`}>{PAY_TEXT[status] ?? status}</span>;
}

export function RunBadge({ run }: { run: Run | null }) {
  if (!run) return <span className="chip run-idle">처리 전</span>;
  return (
    <span className={`chip run-${run.status}`}>
      {run.status === "running" && <Loader2 size={12} className="spin" aria-hidden />}
      {RUN_STATUS_TEXT[run.status] ?? run.status}
    </span>
  );
}

export function AiTag({ children = "AI 제안" }: { children?: ReactNode }) {
  return (
    <span className="ai-tag">
      <Bot size={11} aria-hidden /> {children}
    </span>
  );
}

export function EmptyState({ icon, title, detail, children }: { icon?: ReactNode; title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {detail && <p className="empty-detail">{detail}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="note danger" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="닫기">
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `sec ${className}` : "sec"}>
      <div className="sec-head">
        <h2>{title}</h2>
        {aside && <div className="sec-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={tone ? `metric ${tone}` : "metric"}>
      <span className="metric-label">{label}</span>
      <span className="metric-value num">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

function StepIcon({ state }: { state: string }) {
  if (state === "running") return <Loader2 size={14} className="spin" aria-label="처리 중" />;
  if (state === "done") return <CheckCircle2 size={14} className="ok" aria-label="완료" />;
  if (state === "failed") return <XCircle size={14} className="bad" aria-label="실패" />;
  if (state === "waiting") return <PauseCircle size={14} className="wait" aria-label="대기" />;
  return <CircleDashed size={14} className="idle" aria-label="대기 전" />;
}

/** 에이전트 팀 단계를 한 줄로 보여 준다. 로그는 펼쳐서 본다. */
export function RunStrip({ run, defaultOpen = false }: { run: Run | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const states = stepStates(run);
  const logRef = useRef<HTMLOListElement>(null);
  const count = run?.events.length ?? 0;
  const status = run?.status;
  useEffect(() => {
    if (open) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [count, open]);
  // 처리가 끝나거나 사람 차례가 되면 로그를 접어 결과가 먼저 보이게 한다.
  useEffect(() => {
    if (status && status !== "running") setOpen(false);
  }, [status]);
  return (
    <div className={`runstrip ${run?.status ?? "idle"}`}>
      <ol className="steps" aria-label="에이전트 팀 진행 단계">
        {STEPS.map((s) => {
          const st = states[s.id] ?? "idle";
          return (
            <li key={s.id} className={`step ${st} ${s.kind}`} title={`${s.label} · ${s.kind === "ai" ? "AI" : s.kind === "code" ? "코드" : "사람"}`}>
              <StepIcon state={st} />
              <span>{s.short}</span>
            </li>
          );
        })}
      </ol>
      <div className="runstrip-side">
        <RunBadge run={run} />
        {run && (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            로그 {run.events.filter((e) => e.text).length}
            <ChevronDown size={14} aria-hidden className={open ? "rot" : ""} />
          </button>
        )}
      </div>
      {open && run && (
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
      )}
      {run?.error && <ErrorNote message={run.error} />}
    </div>
  );
}

/** 가명화 토큰([전화1])과 메시지 참조(m3)를 사람이 읽을 수 있게 바꾼다. */
export function RichText({ text, messages }: { text: string; messages?: Plan["messages"] }) {
  const parts = text.split(/(\[전화\d+\]|\bm\d+\b|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\[전화\d+\]$/.test(p)) return <span key={i} className="mask" title="모델에 보내기 전에 가명화한 전화번호. 출고 자료에서는 복원됩니다.">전화번호</span>;
        const iso = p.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
        if (iso) return <span key={i} className="num">{`${Number(iso[2])}/${Number(iso[3])} ${iso[4]}`}</span>;
        const m = /^m(\d+)$/.test(p) ? messages?.find((x) => x.id === p) : undefined;
        if (m) {
          const hhmm = m.at.length >= 16 ? m.at.slice(11, 16) : "";
          // AI가 "m8 07:41 …"처럼 시각을 이미 적었으면 참조 토큰만 지운다.
          if (hhmm && parts[i + 1]?.trimStart().startsWith(hhmm)) return null;
          return <span key={i} className="msg-ref num" title={m.text}>{hhmm ? `${hhmm} 메시지` : p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** 원문 메시지 목록. 근거로 쓰인 메시지는 표시한다. */
export function MessageList({ messages, evidence, compact }: { messages: Plan["messages"]; evidence?: Set<string>; compact?: boolean }) {
  if (!messages.length) return <p className="muted small">원문 메시지가 없습니다.</p>;
  return (
    <ol className={compact ? "msgs compact" : "msgs"}>
      {messages.map((m) => {
        const used = evidence?.has(m.id);
        return (
          <li key={m.id} className={used ? "msg used" : "msg"}>
            <div className="msg-meta">
              <b>{m.sender}</b>
              <span className="num">{m.at.length >= 16 ? m.at.slice(5, 16).replace("T", " ") : m.at}</span>
              {used && (
                <span className="msg-used">
                  <Check size={11} aria-hidden /> 근거
                </span>
              )}
            </div>
            <p>
              <RichText text={m.text} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function Evidence({ items }: { items: { id: string; at: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="evidence">
      {items.map((e) => (
        <li key={e.id}>
          <span className="muted num">{e.at ? e.at.slice(11, 16) : e.id}</span> <RichText text={e.text} />
        </li>
      ))}
    </ul>
  );
}

export function Spinner({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div className="center" role="status">
      <Loader2 className="spin" aria-hidden /> {label}
    </div>
  );
}
