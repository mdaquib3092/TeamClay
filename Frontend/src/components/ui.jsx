import { CHIP, STEPS } from "../data.js";

/** Renders [bracketed text] as a grey italic placeholder. */
export function Txt({ children }) {
  return String(children).split(/(\[[^\]]+\])/).map((p, i) =>
    /^\[[^\]]+\]$/.test(p) ? <span key={i} className="ph">{p}</span> : p);
}
export const Chip = ({ status }) => <span className={`chip ${CHIP[status]}`}>{status}</span>;
export const Flags = ({ list }) => list.map(([t, c]) => <span key={t} className={`flag ${c}`}>{t}</span>);
export const Rule = () => <div className="rule">Clay recommends. People decide.</div>;

export function StatusBar({ status }) {
  const idx = STEPS.indexOf(status);
  const cls = (s, i) => {
    if (status === "In stock") return i === 0 ? "end-ok" : "";
    if (status === "Approved" || status === "Sent back") {
      if (i <= 4) return "done";
      return s === status ? (status === "Approved" ? "end-ok" : "end-bad") : "";
    }
    return i < idx ? "done" : i === idx ? "now" : "";
  };
  return (
    <ol className="steps" aria-label="Request status">
      {STEPS.map((s, i) => (
        <li key={s} className={cls(s, i)} aria-current={s === status ? "step" : undefined}>
          <span className="dot" aria-hidden="true" />{s}
        </li>))}
    </ol>);
}

export function DecisionBanner({ r }) {
  if (r.stage === "approved") return <div className="banner" role="status">{r.decision.text}.</div>;
  if (r.stage === "sentback") return <div className="banner" role="status" style={{ background: "var(--bad)" }}>{r.decision.text}. Reason: {r.decision.reason}</div>;
  return null;
}

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">
    {tabs.map(([k, label]) => (
      <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>))}
  </div>);

export const Seg = ({ label, options, value, onChange }) => (
  <div className="seg" aria-label={label}>
    {options.map(([k, l]) => <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
  </div>);
