// 页面层: 只负责渲染与交互, 业务判断全部走规则层, 数据读写全部走数据层。

import { useMemo, useState, type ReactNode } from "react";
import "./styles.css";
import type { AppState, Priority, Schedule, TestResult } from "./data/types";
import { loadState, resetState, saveState } from "./data/store";
import { DAILY_CAP_LITERS, PRIORITY_LABEL, RULE_TEXT, TANK_KINDS } from "./rules/constants";
import { checkEligibility, compareTests, latestTestOf } from "./rules/tests";
import {
  buildLedgers,
  detectConflicts,
  maxSingleChangeLiters,
  previewPlacement,
  type Allocation,
  type Conflict,
  type DayLedger,
} from "./rules/allocation";
import {
  addSchedule,
  addWaterTest,
  adjustSchedule,
  cancelSchedule,
  executeSchedule,
  registerTank,
  reviseSchedule,
  type OpResult,
} from "./rules/operations";

const TEST_META: Record<TestResult, { label: string; cls: string }> = {
  pass: { label: "合格", cls: "ok" },
  watch: { label: "关注", cls: "watch" },
  abnormal: { label: "异常", cls: "danger" },
};

interface Notice {
  kind: "ok" | "err";
  text: string;
}

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtLiters(n: number): string {
  return `${Math.round(n * 10) / 10}L`;
}

function tankName(state: AppState, tankId: string): string {
  return state.tanks.find((t) => t.id === tankId)?.name ?? tankId;
}

function TestBadge({ result }: { result: TestResult | null }) {
  if (!result) return <span className="badge muted">未检测</span>;
  const meta = TEST_META[result];
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = priority === "high" ? "p-high" : priority === "medium" ? "p-med" : "p-low";
  return <span className={`badge ${cls}`}>{PRIORITY_LABEL[priority]}优先级</span>;
}

function ScheduleStatusBadge({ s }: { s: Schedule }) {
  if (s.superseded) return <span className="badge muted">已修订 · 旧值保留</span>;
  if (s.status === "executed") return <span className="badge ok">已执行 · 冻结</span>;
  return <span className="badge info">待执行</span>;
}

/** 占用预览提示: 新建/调整/修订时实时显示单缸上限、当日剩余与预计缺口 */
function PlacementHint(props: {
  state: AppState;
  tankId: string;
  date: string;
  amountLiters: number;
  excludeId?: string;
  createdAt?: string;
}) {
  const { state, tankId, date, amountLiters } = props;
  if (!tankId || !date || !Number.isFinite(amountLiters) || amountLiters <= 0) return null;
  const maxSingle = maxSingleChangeLiters(state, tankId);
  const preview = previewPlacement(state, {
    tankId,
    date,
    amountLiters,
    excludeId: props.excludeId,
    createdAt: props.createdAt,
  });
  const overSingle = amountLiters > maxSingle;
  const warn = overSingle || preview.shortfallLiters > 0;
  return (
    <p className={`hint ${warn ? "warn" : "ok"}`}>
      单缸上限 {fmtLiters(maxSingle)} · 该日剩余 {fmtLiters(preview.remainingBefore)}
      {overSingle
        ? " · 超单缸上限, 触发 R3"
        : preview.shortfallLiters > 0
          ? ` · 预计缺口 ${fmtLiters(preview.shortfallLiters)}, 触发 R2`
          : " · 可全额占用"}
    </p>
  );
}

function TankRegisterForm({ onSubmit }: { onSubmit: (input: { name: string; kind: string; volumeLiters: number; priority: Priority }) => boolean }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(TANK_KINDS[0]);
  const [volume, setVolume] = useState("120");
  const [priority, setPriority] = useState<Priority>("medium");
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (onSubmit({ name: name.trim(), kind, volumeLiters: Number(volume), priority })) setName("");
      }}
    >
      <label className="full">
        <span>名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如: 草缸E" />
      </label>
      <label>
        <span>类型</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {TANK_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        <span>登记水量(L)</span>
        <input type="number" min="1" step="1" value={volume} onChange={(e) => setVolume(e.target.value)} />
      </label>
      <label className="full">
        <span>维护优先级</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </label>
      <button className="primary-action full" type="submit">登记鱼缸</button>
    </form>
  );
}

function TestEntryForm({ state, onSubmit }: { state: AppState; onSubmit: (input: { tankId: string; date: string; ph: number; ammonia: number; nitrite: number; nitrate: number }) => boolean }) {
  const [tankId, setTankId] = useState(state.tanks[0]?.id ?? "");
  const [date, setDate] = useState(todayStr());
  const [ph, setPh] = useState("7.0");
  const [ammonia, setAmmonia] = useState("0.05");
  const [nitrite, setNitrite] = useState("0.02");
  const [nitrate, setNitrate] = useState("20");
  const effectiveTankId = state.tanks.some((t) => t.id === tankId) ? tankId : (state.tanks[0]?.id ?? "");
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          tankId: effectiveTankId,
          date,
          ph: Number(ph),
          ammonia: Number(ammonia),
          nitrite: Number(nitrite),
          nitrate: Number(nitrate),
        });
      }}
    >
      <label className="full">
        <span>鱼缸</span>
        <select value={effectiveTankId} onChange={(e) => setTankId(e.target.value)}>
          {state.tanks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="full">
        <span>检测日期</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span>pH</span>
        <input type="number" step="0.1" min="0" max="14" value={ph} onChange={(e) => setPh(e.target.value)} />
      </label>
      <label>
        <span>氨氮(mg/L)</span>
        <input type="number" step="0.01" min="0" value={ammonia} onChange={(e) => setAmmonia(e.target.value)} />
      </label>
      <label>
        <span>亚硝酸盐(mg/L)</span>
        <input type="number" step="0.01" min="0" value={nitrite} onChange={(e) => setNitrite(e.target.value)} />
      </label>
      <label>
        <span>硝酸盐(ppm)</span>
        <input type="number" step="1" min="0" value={nitrate} onChange={(e) => setNitrate(e.target.value)} />
      </label>
      <button className="primary-action full" type="submit">录入检测并判定</button>
    </form>
  );
}

function TankTable({ state }: { state: AppState }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>鱼缸</th>
            <th>类型</th>
            <th>登记水量</th>
            <th>单次上限</th>
            <th>维护优先级</th>
            <th>最近检测</th>
            <th>换水资格</th>
          </tr>
        </thead>
        <tbody>
          {state.tanks.map((tank) => {
            const latest = latestTestOf(state, tank.id);
            const elig = checkEligibility(state, tank.id);
            return (
              <tr key={tank.id}>
                <td>
                  <strong>{tank.name}</strong>
                  <span className="cell-sub">{tank.id}</span>
                </td>
                <td>{tank.kind}</td>
                <td>{fmtLiters(tank.volumeLiters)}</td>
                <td>{fmtLiters(maxSingleChangeLiters(state, tank.id))}</td>
                <td><PriorityBadge priority={tank.priority} /></td>
                <td>
                  {latest ? (
                    <>
                      <TestBadge result={latest.result} />
                      <span className="cell-sub">{latest.date}</span>
                    </>
                  ) : (
                    <TestBadge result={null} />
                  )}
                </td>
                <td>
                  {elig.ok ? (
                    <span className="badge ok">可排换水</span>
                  ) : (
                    <span className="badge danger" title={elig.reason ?? ""}>禁止 · {elig.reason}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentTests({ state }: { state: AppState }) {
  const list = [...state.tests].sort((a, b) => compareTests(b, a)).slice(0, 6);
  if (list.length === 0) return <p className="empty">暂无检测记录。</p>;
  return (
    <ul className="test-list">
      {list.map((t) => (
        <li key={t.id}>
          <div>
            <strong>{tankName(state, t.tankId)}</strong>
            <span className="cell-sub">
              {t.date} · pH {t.ph} · 氨氮 {t.ammonia} · 亚硝 {t.nitrite} · 硝酸盐 {t.nitrate}
            </span>
          </div>
          <TestBadge result={t.result} />
        </li>
      ))}
    </ul>
  );
}

function ScheduleForm({ state, onSubmit }: { state: AppState; onSubmit: (input: { tankId: string; date: string; amountLiters: number }) => boolean }) {
  const [tankId, setTankId] = useState(state.tanks[0]?.id ?? "");
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("40");
  const effectiveTankId = state.tanks.some((t) => t.id === tankId) ? tankId : (state.tanks[0]?.id ?? "");
  const amountNum = Number(amount);
  return (
    <form
      className="form-grid cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ tankId: effectiveTankId, date, amountLiters: amountNum });
      }}
    >
      <label>
        <span>鱼缸 (异常未复测合格不可选)</span>
        <select value={effectiveTankId} onChange={(e) => setTankId(e.target.value)}>
          {state.tanks.map((t) => {
            const elig = checkEligibility(state, t.id);
            return (
              <option key={t.id} value={t.id} disabled={!elig.ok}>
                {t.name} · {fmtLiters(t.volumeLiters)} · {PRIORITY_LABEL[t.priority]}优先级{elig.ok ? "" : " · 禁止排换水"}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        <span>换水日期</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span>换水量(L)</span>
        <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="full hint-row">
        <PlacementHint state={state} tankId={effectiveTankId} date={date} amountLiters={amountNum} />
      </div>
      <button className="primary-action" type="submit">新建排程</button>
    </form>
  );
}

function QuotaPanel({ state, ledgers }: { state: AppState; ledgers: Map<string, DayLedger> }) {
  const dates = [...ledgers.keys()].sort();
  if (dates.length === 0) return <p className="empty">暂无排程占用。</p>;
  return (
    <div className="quota-list">
      {dates.map((date) => {
        const ledger = ledgers.get(date)!;
        const pct = Math.min(100, Math.round((ledger.used / ledger.cap) * 100));
        const hasShortfall = ledger.allocations.some((a) => a.shortfallLiters > 0);
        return (
          <div className="quota-day" key={date}>
            <div className="quota-head">
              <strong>{date}</strong>
              <span>
                已占 {fmtLiters(ledger.used)} / {fmtLiters(ledger.cap)} · 剩余 {fmtLiters(ledger.remaining)}
              </span>
            </div>
            <div className={`quota-bar ${hasShortfall ? "over" : pct >= 100 ? "full" : ""}`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <ul className="quota-items">
              {ledger.allocations.map((a) => {
                const s = state.schedules.find((x) => x.id === a.scheduleId);
                if (!s) return null;
                const tank = state.tanks.find((t) => t.id === s.tankId);
                return (
                  <li key={a.scheduleId}>
                    <span>
                      {s.id} · {tank?.name ?? s.tankId} · {PRIORITY_LABEL[tank?.priority ?? "low"]}优先级
                      {s.status === "executed" ? " · 已执行" : ""}
                    </span>
                    <span className={a.shortfallLiters > 0 ? "shortfall" : ""}>
                      实占 {fmtLiters(a.allocatedLiters)} / 申请 {fmtLiters(s.amountLiters)}
                      {a.shortfallLiters > 0 ? ` · 缺口 ${fmtLiters(a.shortfallLiters)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleTable(props: {
  state: AppState;
  allocations: Map<string, Allocation>;
  onExecute: (id: string) => boolean;
  onAdjust: (id: string, input: { date: string; amountLiters: number }) => boolean;
  onCancel: (id: string) => boolean;
  onRevise: (id: string, input: { date: string; amountLiters: number; reason: string }) => boolean;
}) {
  const { state, allocations } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const [revReason, setRevReason] = useState("");
  const [revDate, setRevDate] = useState("");
  const [revAmount, setRevAmount] = useState("");

  const rows = [...state.schedules].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)
  );

  const closeEditors = () => {
    setEditingId(null);
    setRevisingId(null);
  };

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>鱼缸</th>
            <th>日期</th>
            <th>申请水量</th>
            <th>额度占用</th>
            <th>优先级</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const tank = state.tanks.find((t) => t.id === s.tankId);
            const alloc = allocations.get(s.id);
            const active = !s.superseded;
            return (
              <ScheduleRow
                key={s.id}
                row={
                  <>
                    <td>{s.id}</td>
                    <td>
                      <strong>{tank?.name ?? s.tankId}</strong>
                      {s.revisionOf ? <span className="cell-sub">修订自 {s.revisionOf}: {s.revisionReason}</span> : null}
                    </td>
                    <td>{s.date}</td>
                    <td>{fmtLiters(s.amountLiters)}</td>
                    <td>
                      {active && alloc ? (
                        <>
                          实占 {fmtLiters(alloc.allocatedLiters)}
                          {alloc.shortfallLiters > 0 ? <span className="shortfall"> · 缺口 {fmtLiters(alloc.shortfallLiters)}</span> : null}
                        </>
                      ) : (
                        <span className="cell-sub">已释放</span>
                      )}
                    </td>
                    <td>{tank ? <PriorityBadge priority={tank.priority} /> : "—"}</td>
                    <td><ScheduleStatusBadge s={s} /></td>
                    <td>
                      <div className="row-actions">
                        {active && s.status === "planned" ? (
                          <>
                            <button className="btn-small" onClick={() => { if (props.onExecute(s.id)) closeEditors(); }}>执行</button>
                            <button
                              className="btn-small"
                              onClick={() => {
                                setRevisingId(null);
                                setEditingId(s.id);
                                setEditDate(s.date);
                                setEditAmount(String(s.amountLiters));
                              }}
                            >
                              调整
                            </button>
                            <button className="btn-small btn-danger" onClick={() => { if (props.onCancel(s.id)) closeEditors(); }}>取消</button>
                          </>
                        ) : null}
                        {active && s.status === "executed" ? (
                          <button
                            className="btn-small"
                            onClick={() => {
                              setEditingId(null);
                              setRevisingId(s.id);
                              setRevReason("");
                              setRevDate(s.date);
                              setRevAmount(String(s.amountLiters));
                            }}
                          >
                            修订
                          </button>
                        ) : null}
                        {!active ? <span className="cell-sub">冻结</span> : null}
                      </div>
                    </td>
                  </>
                }
                editor={
                  editingId === s.id ? (
                    <tr className="editor-row">
                      <td colSpan={8}>
                        <form
                          className="inline-editor"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (props.onAdjust(s.id, { date: editDate, amountLiters: Number(editAmount) })) closeEditors();
                          }}
                        >
                          <span className="editor-title">调整 {s.id} (先释放原额度再重算)</span>
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                          <input type="number" min="1" step="1" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                          <button className="primary-action btn-small" type="submit">保存调整</button>
                          <button className="btn-small" type="button" onClick={closeEditors}>取消</button>
                          <PlacementHint state={state} tankId={s.tankId} date={editDate} amountLiters={Number(editAmount)} excludeId={s.id} createdAt={s.createdAt} />
                        </form>
                      </td>
                    </tr>
                  ) : revisingId === s.id ? (
                    <tr className="editor-row">
                      <td colSpan={8}>
                        <form
                          className="inline-editor"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (props.onRevise(s.id, { date: revDate, amountLiters: Number(revAmount), reason: revReason })) closeEditors();
                          }}
                        >
                          <span className="editor-title">修订 {s.id} (旧值冻结保留)</span>
                          <input value={revReason} onChange={(e) => setRevReason(e.target.value)} placeholder="修订原因 (必填)" />
                          <input type="date" value={revDate} onChange={(e) => setRevDate(e.target.value)} />
                          <input type="number" min="1" step="1" value={revAmount} onChange={(e) => setRevAmount(e.target.value)} />
                          <button className="primary-action btn-small" type="submit">提交修订</button>
                          <button className="btn-small" type="button" onClick={closeEditors}>取消</button>
                          <PlacementHint state={state} tankId={s.tankId} date={revDate} amountLiters={Number(revAmount)} excludeId={s.id} />
                        </form>
                      </td>
                    </tr>
                  ) : null
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleRow({ row, editor }: { row: ReactNode; editor: ReactNode }) {
  return (
    <>
      <tr>{row}</tr>
      {editor}
    </>
  );
}

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) {
    return <p className="empty">当前无冲突: 检测资格、共享额度与单缸限量均满足。</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>鱼缸</th>
            <th>日期</th>
            <th>缺口</th>
            <th>触发规则</th>
            <th>涉及排程</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr key={`${c.scheduleId}-${c.ruleId}`}>
              <td><strong>{c.tankName}</strong></td>
              <td>{c.date}</td>
              <td><span className="shortfall">缺口 {fmtLiters(c.shortfallLiters)}</span></td>
              <td>{c.rule}</td>
              <td>{c.scheduleId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevisionChains({ state }: { state: AppState }) {
  const byId = new Map(state.schedules.map((s) => [s.id, s]));
  const chains = new Map<string, Schedule[]>();
  for (const s of state.schedules) {
    let root = s;
    while (root.revisionOf && byId.has(root.revisionOf)) {
      root = byId.get(root.revisionOf)!;
    }
    const list = chains.get(root.id) ?? [];
    list.push(s);
    chains.set(root.id, list);
  }
  const list = [...chains.values()]
    .filter((chain) => chain.length > 1)
    .map((chain) => [...chain].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  if (list.length === 0) return <p className="empty">暂无修订记录。</p>;
  return (
    <div className="chain-list">
      {list.map((chain) => (
        <div className="chain" key={chain[0].id}>
          <strong>修订链 {chain[0].id} · {tankName(state, chain[0].tankId)}</strong>
          {chain.map((s, i) => (
            <div className="chain-node" key={s.id}>
              <span className="chain-ver">v{i + 1}</span>
              <span>{s.id} · {s.date} · {fmtLiters(s.amountLiters)}</span>
              <ScheduleStatusBadge s={s} />
              {s.revisionReason ? <span className="cell-sub">原因: {s.revisionReason}</span> : null}
              {i === 0 && s.superseded ? <span className="cell-sub">旧值冻结保留, 额度已转移</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [notice, setNotice] = useState<Notice | null>(null);

  const ledgers = useMemo(() => buildLedgers(state), [state]);
  const conflicts = useMemo(() => detectConflicts(state), [state]);
  const allocations = useMemo(() => {
    const map = new Map<string, Allocation>();
    ledgers.forEach((ledger) => ledger.allocations.forEach((a) => map.set(a.scheduleId, a)));
    return map;
  }, [ledgers]);

  const run = (res: OpResult, okText: string): boolean => {
    if (res.ok) {
      setState(res.state);
      saveState(res.state);
      setNotice({ kind: "ok", text: okText });
      return true;
    }
    setNotice({ kind: "err", text: res.error });
    return false;
  };

  const today = todayStr();
  const todayLedger = ledgers.get(today);
  const plannedCount = state.schedules.filter((s) => s.status === "planned" && !s.superseded).length;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · 换水排程台</p>
          <h1>水族箱换水排程台</h1>
          <p className="subtitle">
            鱼缸登记水量与维护优先级, 检测异常须复测合格方可排程; 每日换水共享 {fmtLiters(DAILY_CAP_LITERS)} 上限,
            高优先级先占用; 已执行排程冻结, 仅可带原因新建修订并保留旧值。
          </p>
        </div>
        <div className="stack-card">
          <span>排程规则</span>
          <ul className="rule-list">
            <li>{RULE_TEXT.R1}</li>
            <li>{RULE_TEXT.R2}</li>
            <li>{RULE_TEXT.R3}</li>
          </ul>
          <button
            onClick={() => {
              const fresh = resetState();
              setState(fresh);
              setNotice({ kind: "ok", text: "已重置为演示数据" });
            }}
          >
            重置演示数据
          </button>
        </div>
      </section>

      {notice ? (
        <div className={`notice ${notice.kind}`} onClick={() => setNotice(null)}>
          {notice.text}
          <span className="notice-close">✕</span>
        </div>
      ) : null}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>登记鱼缸</span>
          <strong>{state.tanks.length}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>待执行排程</span>
          <strong>{plannedCount}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>今日额度占用</span>
          <strong>{todayLedger ? `${todayLedger.used}/${todayLedger.cap}L` : `0/${DAILY_CAP_LITERS}L`}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>未解冲突</span>
          <strong>{conflicts.length}</strong>
          <i className={conflicts.length > 0 ? "status-danger" : "status-ok"} />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>登记鱼缸</h2>
          <TankRegisterForm onSubmit={(input) => run(registerTank(state, input), `已登记鱼缸 ${input.name}`)} />
          <h2>录入检测</h2>
          <TestEntryForm state={state} onSubmit={(input) => run(addWaterTest(state, input), "检测已录入, 判定结果已更新")} />
          <h2>最近检测</h2>
          <RecentTests state={state} />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>鱼缸登记</p>
              <h2>水量 · 优先级 · 检测状态</h2>
            </div>
          </div>
          <TankTable state={state} />
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>排程台</p>
            <h2>新建排程与每日共享额度</h2>
          </div>
        </div>
        <div className="grid-2">
          <div>
            <h3 className="panel-sub">新建换水排程</h3>
            <ScheduleForm state={state} onSubmit={(input) => run(addSchedule(state, input), "排程已创建, 超额部分将进入冲突列表")} />
          </div>
          <div>
            <h3 className="panel-sub">每日额度占用 (上限 {fmtLiters(DAILY_CAP_LITERS)}, 高优先级先占用)</h3>
            <QuotaPanel state={state} ledgers={ledgers} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>排程列表</p>
            <h2>执行 · 调整 · 修订</h2>
          </div>
        </div>
        <ScheduleTable
          state={state}
          allocations={allocations}
          onExecute={(id) => run(executeSchedule(state, id), `${id} 已执行并冻结`)}
          onAdjust={(id, input) => run(adjustSchedule(state, id, input), `${id} 已调整, 原额度已释放并重算`)}
          onCancel={(id) => run(cancelSchedule(state, id), `${id} 已取消, 额度已释放`)}
          onRevise={(id, input) => run(reviseSchedule(state, id, input), `${id} 已冻结, 修订版本已创建`)}
        />
      </section>

      <section className="panel conflict-panel">
        <div className="section-heading">
          <div>
            <p>冲突</p>
            <h2>待处理冲突 ({conflicts.length})</h2>
          </div>
        </div>
        <ConflictList conflicts={conflicts} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>修订链</p>
            <h2>已执行排程的修订历史</h2>
          </div>
        </div>
        <RevisionChains state={state} />
      </section>
    </main>
  );
}
