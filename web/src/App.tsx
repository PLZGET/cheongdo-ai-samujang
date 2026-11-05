import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Menu, RefreshCw, X } from "lucide-react";
import { api, ApiError, Workspace } from "./api";
import { VIEWS, View } from "./model";
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
  const [inputs, setInputs] = useState<Inputs>({ inbox: ws.state.samples.inbox, deposits: ws.state.samples.deposits });
  const morning = useMorningRun(ws.wsid, reload);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (v: View) => {
    window.location.hash = `#/${v}`;
    setView(v);
    setDrawer(false);
    if (v === "ledger" || v === "shipments") reload();
  };

  const startRun = async () => {
    const ok = await morning.start(inputs.inbox, inputs.deposits);
    if (ok) navigate("orders");
  };

  const committed = ws.state.ledger.orders.length > 0;

  return (
    <div className={drawer ? "app drawer-open" : "app"}>
      <header className="mobilebar">
        <button type="button" className="icon-btn" onClick={() => setDrawer(true)} aria-label="메뉴 열기" aria-expanded={drawer}>
          <Menu size={20} aria-hidden />
        </button>
        <Mark size={22} />
        <strong>AI 사무장</strong>
        <span className="muted small">{ws.state.farm.name.replace(/\(가상\)$/, "")}</span>
      </header>
      {drawer && <button type="button" className="scrim" aria-label="메뉴 닫기" onClick={() => setDrawer(false)} />}
      <div className="sidebar-wrap">
        {drawer && (
          <button type="button" className="icon-btn drawer-close" onClick={() => setDrawer(false)} aria-label="메뉴 닫기">
            <X size={18} aria-hidden />
          </button>
        )}
        <Sidebar ws={ws} run={morning.run} view={view} onNavigate={navigate} onRestart={onRestart} busy={busy} />
      </div>
      <main className="main">
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
      </header>
      <main className="landing-main">
        <section className="hero">
          <h1>
            카톡 주문과 입금 문자를
            <br />
            오늘 보낼 택배로.
          </h1>
          <p className="lead">
            반시 직거래 농가의 아침 업무인 주문 정리, 입금 확인, 재고 배정, 고객 안내를 AI 에이전트 팀이 나눠 맡습니다. 돈과 재고가 움직이는 결정은 사장님이 확인하고 승인합니다.
          </p>
          <div className="cta">
            <button type="button" className="btn primary lg" onClick={onStart} disabled={busy}>
              {busy ? <Loader2 className="spin" size={18} aria-hidden /> : null}
              예제 농가로 체험 시작
              <ArrowRight size={18} aria-hidden />
            </button>
            <span className="muted small">로그인 없이 바로 시작합니다. 방문자마다 별도의 작업공간이 만들어지며, 예제의 사람·주소·전화번호는 모두 합성 데이터입니다.</span>
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
            <b>2. AI 팀이 정리</b>
            <span>접수·정산·배송 에이전트가 병렬로 읽고, 금액·재고·정책은 코드가 계산하고, 검토 에이전트가 원문과 다시 대조합니다.</span>
          </div>
          <div>
            <b>3. 확인하고 승인</b>
            <span>확인 질문에 답하고 출고안을 승인하면 장부·재고가 한 번에 확정되고 택배 CSV가 나옵니다.</span>
          </div>
        </section>
      </main>
    </div>
  );
}
