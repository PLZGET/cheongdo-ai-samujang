import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Menu, RefreshCw, X } from "lucide-react";
import { api, ApiError, Workspace } from "./api";
import { VIEWS, View, todayLabel } from "./model";
import { useMorningRun } from "./useMorningRun";
import Sidebar, { Mark } from "./Sidebar";
import Today from "./Today";
import Orders, { Inputs } from "./Orders";
import Deposits from "./Deposits";
import Shipments from "./Shipments";
import Ledger from "./Ledger";
import EvaluationView from "./Evaluation";
import { Spinner } from "./ui";

const KEY = "samujang.wsid";

function viewFromHash(): View {
  const v = window.location.hash.replace(/^#\/?/, "") as View;
  return VIEWS.includes(v) ? v : "today";
}

export default function App() {
  const [wsid, setWsid] = useState<string | null>(() => localStorage.getItem(KEY));
  const [ws, setWs] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const currentWsid = useRef(wsid);
  currentWsid.current = wsid;

  const reload = useCallback(async () => {
    if (!wsid) return;
    try {
      const fresh = await api.workspace(wsid);
      if (currentWsid.current !== wsid) return;
      setWs(fresh);
      setLoadError(null);
    } catch (e) {
      if (currentWsid.current !== wsid) return;
      if (e instanceof ApiError && e.status === 404) {
        // 서버에 없는 작업공간일 때만 잊는다. 일시 오류는 기존 작업공간을 유지한다.
        localStorage.removeItem(KEY);
        setWsid(null);
        setWs(null);
        setError((e as Error).message);
      } else {
        setLoadError((e as Error).message);
      }
    }
  }, [wsid]);

  useEffect(() => {
    reload();
  }, [reload]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { wsid: id } = await api.createWorkspace();
      localStorage.setItem(KEY, id);
      window.location.hash = "#/today";
      setWs(null);
      setLoadError(null);
      setWsid(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!wsid) return <Landing onStart={start} busy={busy} error={error} />;
  if (!ws)
    return loadError ? (
      <div className="landing">
        <main className="landing-main">
          <p className="note danger" role="alert">
            작업공간을 불러오지 못했습니다. 기존 작업공간은 그대로 있습니다. ({loadError})
          </p>
          <button type="button" className="btn primary" onClick={reload}>
            <RefreshCw size={16} aria-hidden /> 다시 연결
          </button>
        </main>
      </div>
    ) : (
      <Spinner label="작업공간을 불러오는 중" />
    );
  return (
    <>
      {loadError && (
        <div className="note danger" role="alert" style={{ position: "fixed", bottom: 16, right: 16, zIndex: 50, maxWidth: 420 }}>
          <span>최신 장부를 다시 읽지 못했습니다. 화면은 마지막으로 받은 내용입니다. ({loadError})</span>
          <button type="button" className="btn ghost sm" onClick={reload}>
            <RefreshCw size={14} aria-hidden /> 다시 읽기
          </button>
        </div>
      )}
      <Shell key={ws.wsid} ws={ws} reload={reload} onRestart={start} busy={busy} />
    </>
  );
}

function Shell({ ws, reload, onRestart, busy }: { ws: Workspace; reload: () => Promise<void>; onRestart: () => void; busy: boolean }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [inputs, setInputs] = useState<Inputs>({ inbox: ws.state.samples.inbox, deposits: ws.state.samples.deposits });
  const morning = useMorningRun(ws.wsid, reload);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], summary") ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [drawer]);

  const navigate = (v: View) => {
    window.location.hash = `#/${v}`;
    setView(v);
    setDrawer(false);
    requestAnimationFrame(() => document.getElementById("workspace-main")?.focus({ preventScroll: true }));
    if (v === "ledger" || v === "shipments") reload();
  };

  const startRun = async () => {
    const ok = await morning.start(inputs.inbox, inputs.deposits);
    if (ok) navigate("orders");
  };

  const committed = ws.state.ledger.orders.length > 0;

  return (
    <div className={drawer ? "app drawer-open" : "app"}>
      <a className="skip-link" href="#workspace-main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("workspace-main")?.focus();
      }}>본문으로 이동</a>
      <header className="appbar">
        <button ref={menuButton} type="button" className="icon-btn menu-toggle" onClick={() => setDrawer(true)} aria-label="메뉴 열기" aria-expanded={drawer} aria-controls="workspace-navigation">
          <Menu size={20} aria-hidden />
        </button>
        <button type="button" className="app-brand" onClick={() => navigate("today")} aria-label="청도 농가 AI 사무장 오늘 업무">
          <Mark size={28} /><strong>청도 농가 <span>AI 사무장</span></strong>
        </button>
        <div className="appbar-account">
          <span className="appbar-farm">{ws.state.farm.name.replace(/\(가상\)$/, "")} <span className="tag">예제 농가</span></span>
          <span className="appbar-date">{todayLabel(ws.state.business_date)}</span>
          <span className="avatar" aria-label={`농가 운영자 ${ws.state.farm.owner}`}>{ws.state.farm.owner.slice(0, 1)}</span>
        </div>
      </header>
      {drawer && <button type="button" className="scrim" aria-label="메뉴 닫기" tabIndex={-1} onClick={() => { setDrawer(false); menuButton.current?.focus(); }} />}
      <div className="sidebar-wrap" id="workspace-navigation" ref={drawerRef} role={drawer ? "dialog" : undefined} aria-modal={drawer ? true : undefined} aria-label={drawer ? "업무 메뉴" : undefined}>
        {drawer && (
          <button type="button" className="icon-btn drawer-close" onClick={() => { setDrawer(false); menuButton.current?.focus(); }} aria-label="메뉴 닫기">
            <X size={18} aria-hidden />
          </button>
        )}
        <Sidebar ws={ws} run={morning.run} view={view} onNavigate={navigate} onRestart={onRestart} busy={busy} />
      </div>
      <main className="main" id="workspace-main" tabIndex={-1}>
        {view === "today" && <Today ws={ws} morning={morning} onNavigate={navigate} onStart={startRun} />}
        {view === "orders" && <Orders ws={ws} morning={morning} inputs={inputs} setInputs={setInputs} onNavigate={navigate} />}
        {view === "deposits" && <Deposits ws={ws} plan={morning.plan} run={morning.run} depositsText={inputs.deposits} onNavigate={navigate} />}
        {view === "shipments" && <Shipments ws={ws} plan={morning.plan} run={morning.run} onNavigate={navigate} />}
        {view === "ledger" && <Ledger ws={ws} onRefresh={reload} onNavigate={navigate} />}
        {view === "evaluation" && <EvaluationView ws={ws} committed={committed} onNavigate={navigate} />}
      </main>
    </div>
  );
}

function Landing({ onStart, busy, error }: { onStart: () => void; busy: boolean; error: string | null }) {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Mark />
        <strong>청도 농가 AI 사무장</strong>
        <a href="https://github.com/PLZGET/cheongdo-ai-samujang" target="_blank" rel="noreferrer" className="landing-repo">프로젝트 소개 <ArrowRight size={14} aria-hidden /></a>
      </header>
      <main className="landing-main">
        <section className="hero">
          <h1>
            카톡 주문과 입금 문자를
            <br />
            오늘의 출고 목록으로.
          </h1>
          <p className="lead">
            흩어진 주문과 입금 내역을 고객별로 모아 확인하세요. 주문 정리부터 재고 배정, 출고 자료까지 사무장이 준비하고 사장님이 승인합니다.
          </p>
          <div className="cta">
            <button type="button" className="btn primary lg" onClick={onStart} disabled={busy}>
              {busy ? <Loader2 className="spin" size={18} aria-hidden /> : null}
              예제 농가로 체험 시작
              <ArrowRight size={18} aria-hidden />
            </button>
            <span className="muted small">회원가입 없이, 준비된 예제로 체험하세요.</span>
          </div>
          {error && (
            <p className="note danger" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="landing-flow" aria-label="처리 흐름">
          <div>
            <b>1. 자료 넣기</b>
            <span>카카오톡 대화 내보내기와 은행 입금 문자를 붙여넣습니다. 예제가 미리 채워져 있습니다.</span>
          </div>
          <div>
            <b>2. 고객별로 확인</b>
            <span>주문 원문과 입금 내역을 한 화면에서 보고, 확인이 필요한 질문에 답합니다.</span>
          </div>
          <div>
            <b>3. 확인하고 승인</b>
            <span>확인 질문에 답하고 출고안을 승인하면 장부·재고가 한 번에 확정되고 택배 CSV가 나옵니다.</span>
          </div>
        </section>
        <footer className="landing-footer">
          <p>2026 청도 바이브코딩 해커톤 · 대구한의대학교 총장상 수상</p>
          <p>방문자마다 별도의 작업공간이 만들어집니다. 예제의 사람·주소·전화번호는 합성 데이터이며, 실제 메시지 발송이나 카카오톡·은행·택배사 연동은 수행하지 않습니다.</p>
        </footer>
      </main>
    </div>
  );
}
