import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, isTransient, Plan, Run, TERMINAL } from "./api";

/** 아침 업무 실행 하나를 따라간다. SSE 구독, 새로고침·연결 끊김 복구, 중복 실행 방지(409 → 기존 실행 재연결)를 맡는다. */
export function useMorningRun(wsid: string, onCommitted: () => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState<"answers" | "approve" | "reject" | "cancel" | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const source = useRef<EventSource | null>(null);
  const committed = useRef(onCommitted);
  committed.current = onCommitted;
  // 현재 따라가는 실행. 늦게 도착한 응답은 이 값과 다르면 버린다.
  const current = useRef<string | null>(null);
  const gen = useRef(0);

  const accept = useCallback((r: Run) => {
    if (current.current !== r.run_id) return;
    // 이벤트 수가 더 적은 스냅샷은 늦게 도착한 이전 상태다.
    setRun((prev) => (prev && prev.run_id === r.run_id && prev.events.length > r.events.length ? prev : r));
  }, []);

  const subscribe = useCallback(
    (runId: string) => {
      source.current?.close();
      current.current = runId;
      const es = new EventSource(api.eventsUrl(wsid, runId));
      source.current = es;
      es.onmessage = (msg) => {
        if (source.current !== es) return;
        const data = JSON.parse(msg.data);
        if (data.type === "run") {
          accept(data.run);
          if (TERMINAL.has(data.run.status)) {
            es.close();
            if (data.run.status === "completed") committed.current();
          }
        } else if (data.type === "event") {
          setRun((prev) => (prev && prev.run_id === runId && !prev.events.some((e) => e.seq === data.event.seq) ? { ...prev, events: [...prev.events, data.event] } : prev));
        }
      };
      es.onerror = () => {
        // 연결이 끊기면 상태를 한 번 다시 읽어 화면을 맞춘다. EventSource가 자동 재연결한다.
        api
          .run(wsid, runId)
          .then((r) => {
            if (source.current !== es) return;
            accept(r);
            if (TERMINAL.has(r.status)) {
              es.close();
              if (r.status === "completed") committed.current();
            }
          })
          .catch(() => undefined);
      };
    },
    [wsid, accept],
  );

  const attachLatest = useCallback(
    async (onlyActive: boolean) => {
      const my = ++gen.current;
      const fresh = await api.workspace(wsid);
      const latest = fresh.runs.find((r) => r.type === "morning" && (!onlyActive || !TERMINAL.has(r.status)));
      if (!latest || my !== gen.current) return false;
      const r = await api.run(wsid, latest.run_id);
      if (my !== gen.current) return false;
      current.current = r.run_id;
      setRun(r);
      if (!TERMINAL.has(r.status)) subscribe(r.run_id);
      return true;
    },
    [wsid, subscribe],
  );

  useEffect(() => {
    setRun(null);
    setError(null);
    attachLatest(false).catch((e) => {
      if (isTransient(e)) setError(`이전 실행을 불러오지 못했습니다. ${(e as Error).message}`);
    });
    return () => {
      gen.current++;
      source.current?.close();
      source.current = null;
    };
  }, [wsid, attachLatest]);

  // 사람 차례(질문/승인)가 새로 오면 전송 상태를 풀고, 질문이 있으면 추천 답으로 초기화한다.
  const requestId = run?.pending?.request_id;
  useEffect(() => {
    setSending(null);
    const qs = run?.pending?.data.questions;
    if (qs) setAnswers(Object.fromEntries(qs.map((q) => [q.id, (q.options.find((o) => o.recommended) ?? q.options[0]).value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  useEffect(() => {
    if (run && TERMINAL.has(run.status)) setSending(null);
  }, [run]);

  const start = async (inbox: string, deposits: string) => {
    if (starting) return false;
    setStarting(true);
    setError(null);
    const my = ++gen.current;
    try {
      const r = await api.startMorning(wsid, inbox, deposits);
      if (my !== gen.current) return false;
      current.current = r.run_id;
      setRun(r);
      subscribe(r.run_id);
      return true;
    } catch (e) {
      // 이미 진행 중인 실행이 있거나 응답만 늦은 경우, 새로 만들지 않고 서버의 진행 중 실행에 다시 연결한다.
      if (((e instanceof ApiError && e.status === 409) || isTransient(e)) && (await attachLatest(true).catch(() => false))) return true;
      setError((e as Error).message);
      return false;
    } finally {
      setStarting(false);
    }
  };

  const respond = async (body: { answers?: Record<string, string>; decision?: "approve" | "reject" }) => {
    if (!run?.pending || sending) return;
    const runId = run.run_id;
    setError(null);
    setSending(body.answers ? "answers" : body.decision ?? "reject");
    try {
      const r = await api.respond(wsid, runId, { request_id: run.pending.request_id, ...body });
      if (current.current !== runId) return;
      accept(r);
      if (!TERMINAL.has(r.status)) subscribe(runId);
    } catch (e) {
      if (current.current !== runId) return;
      setSending(null);
      setError((e as Error).message);
      // 응답이 유실돼도 서버는 반영했을 수 있다. 실제 상태를 다시 읽는다(같은 요청의 재전송은 서버가 무시).
      api.run(wsid, runId).then((r) => {
        accept(r);
        if (!TERMINAL.has(r.status)) subscribe(runId);
      }).catch(() => undefined);
    }
  };

  const cancel = async () => {
    if (!run || TERMINAL.has(run.status) || sending) return;
    const runId = run.run_id;
    setSending("cancel");
    setError(null);
    try {
      accept(await api.cancel(wsid, runId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(null);
    }
  };

  const plan: Plan | null = run?.pending?.data.plan ?? run?.plan ?? null;
  const active = !!run && !TERMINAL.has(run.status);

  return {
    run,
    plan,
    active,
    error,
    starting,
    sending,
    answers,
    setAnswer: (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value })),
    start,
    submitAnswers: () => respond({ answers }),
    decide: (decision: "approve" | "reject") => respond({ decision }),
    cancel,
    dismissError: () => setError(null),
  };
}

export type MorningRun = ReturnType<typeof useMorningRun>;
