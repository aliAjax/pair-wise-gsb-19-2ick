import { useState } from "react";
import "./styles.css";
import { TankRegistry } from "./components/TankRegistry";
import { ScheduleBoard } from "./components/ScheduleBoard";
import { ConflictPanel } from "./components/ConflictPanel";
import { RULES, evaluateEligibility } from "./scheduler/rules";
import { useScheduler } from "./scheduler/store";
import { Field, Modal } from "./components/ui";

const project = {
  id: "hxwl-05",
  port: 5105,
  title: "换水排程台",
  subtitle: "鱼缸登记水量、检测状态与维护优先级；异常未复测合格不能排换水，按日期共享额度、高优先级先占用。",
  stack: "React + Vite + TypeScript + CSS（数据 / 规则 / 页面分层，无新增依赖）",
};

function MetricCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "ok" | "watch" | "danger" | "neutral";
  hint?: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
      <i className={`bar bar-${tone}`} />
    </article>
  );
}

function App() {
  const {
    state,
    allocations,
    currentConflicts,
    reportConflicts,
    addTank,
    updateTank,
    tankRemovable,
    removeTank,
    addTest,
    removeTest,
    saveSchedule,
    executeSchedule,
    removeSchedule,
    setCap,
    resetToSeed,
    dismissReport,
  } = useScheduler();

  const [capOpen, setCapOpen] = useState(false);
  const [capDraft, setCapDraft] = useState(String(state.defaultCap));

  const pendingSchedules = state.schedules.filter((s) => s.status === "pending");
  const frozenCount = state.schedules.length - pendingSchedules.length;
  const revisionCount = state.schedules.filter((s) => s.revisionOfId).length;
  const blockedTanks = state.tanks.filter((t) => !evaluateEligibility(state.tests, t.id).eligible).length;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈 / 分层</span>
          <strong>{project.stack}</strong>
          <button className="reset-btn" onClick={resetToSeed}>
            恢复示例数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="登记鱼缸"
          value={String(state.tanks.length)}
          tone="neutral"
          hint={`${blockedTanks} 个检测准入未通过`}
        />
        <MetricCard
          label="未执行换水单"
          value={String(pendingSchedules.length)}
          tone="watch"
          hint={`其中修订 ${revisionCount} 条`}
        />
        <MetricCard
          label="已执行冻结"
          value={String(frozenCount)}
          tone="ok"
          hint="只可带原因修订，旧值保留"
        />
        <MetricCard
          label="现存冲突"
          value={String(currentConflicts.length)}
          tone={currentConflicts.length > 0 ? "danger" : "ok"}
          hint={currentConflicts.length > 0 ? "见底部冲突清单" : "鱼缸 / 检测 / 额度 / 修订链一致"}
        />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>排程规则</h2>
          <ul className="rule-list">
            {RULES.map((r) => (
              <li key={r.code}>
                <span className="rule-code">{r.code}</span>
                <p>{r.text}</p>
              </li>
            ))}
          </ul>
          <h2>默认每日额度</h2>
          <p className="cap-default">
            <strong>{state.defaultCap}L</strong>
            <button
              onClick={() => {
                setCapDraft(String(state.defaultCap));
                setCapOpen(true);
              }}
            >
              修改
            </button>
          </p>
          <p className="aside-hint">
            额度、占用与冲突不单独存储，每次渲染与刷新都由鱼缸、检测、排程数据实时推导，杜绝不一致。
          </p>
        </aside>

        <div className="panel-stack">
          <TankRegistry
            state={state}
            onAddTank={addTank}
            onUpdateTank={updateTank}
            onRemoveTank={removeTank}
            tankRemovable={tankRemovable}
            onAddTest={addTest}
            onRemoveTest={removeTest}
          />
          <ScheduleBoard
            state={state}
            allocations={allocations}
            onSave={saveSchedule}
            onExecute={executeSchedule}
            onDelete={removeSchedule}
            onSetCap={setCap}
          />
        </div>
      </section>

      <ConflictPanel
        live={currentConflicts}
        rejected={reportConflicts}
        onDismissRejected={dismissReport}
      />

      {capOpen ? (
        <Modal title="设置默认每日换水额度" onClose={() => setCapOpen(false)}>
          <div className="form-grid">
            <Field label="默认额度（升/天）" hint="下调后所有未设专属额度的日期按优先级重算，超额将拒绝（R2）">
              <input type="number" min={0} value={capDraft} onChange={(e) => setCapDraft(e.target.value)} />
            </Field>
          </div>
          <div className="modal-actions">
            <button onClick={() => setCapOpen(false)}>取消</button>
            <button
              className="primary-action"
              disabled={!(Number(capDraft) >= 0)}
              onClick={() => {
                if (setCap(null, Number(capDraft))) setCapOpen(false);
              }}
            >
              保存
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

export default App;
