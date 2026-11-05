import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, Evaluation } from "./api";

export default function EvaluationView({ wsid }: { wsid: string }) {
  const [data, setData] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evaluation(wsid).then(setData).catch((e: Error) => setError(e.message));
  }, [wsid]);

  if (error)
    return (
      <section className="panel">
        <h2>정답 대조</h2>
        <p className="muted">{error}</p>
      </section>
    );
  if (!data)
    return (
      <div className="center" role="status">
        <Loader2 className="spin" aria-hidden /> 불러오는 중
      </div>
    );

  return (
    <section className="panel" aria-labelledby="eval-title">
      <h2 id="eval-title">정답 장부와 대조</h2>
      <p className="muted small">{data.note}</p>
      <dl className="summary">
        {Object.entries(data.summary).map(([name, s]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd className="num">
              {s.matched}/{s.total}
            </dd>
          </div>
        ))}
      </dl>
      {Object.entries(data.details).map(([name, rows]) => (
        <details key={name} open={rows.some((r) => !r.match)}>
          <summary>{name}</summary>
          <ul className="plain-list">
            {rows.map((r, i) => (
              <li key={i}>
                {r.match ? <CheckCircle2 size={14} className="ok" aria-label="일치" /> : <XCircle size={14} className="bad" aria-label="불일치" />}{" "}
                <code>{JSON.stringify(r.expected ?? r)}</code>
                {!r.match && "actual" in r ? <span className="muted"> 실제: {String(r.actual)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {data.extra_lines.length > 0 && (
        <p className="error">정답에 없는 줄: {data.extra_lines.map((l) => JSON.stringify(l)).join(", ")}</p>
      )}
    </section>
  );
}
