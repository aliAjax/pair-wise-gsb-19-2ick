import { useMemo, useState } from "react";
import {
  PRIORITY_LABEL,
  RULES,
  STATUS_LABEL,
  evaluateEligibility,
  getCap,
  planScheduleChange,
  todayISO,
} from "../scheduler/rules";
import type { DayAllocation, RootState, Schedule } from "../scheduler/types";
import type { ScheduleDraft } from "../scheduler/types";
import { Field, Modal, PriorityBadge } from "./ui";

interface ScheduleFormState {
  tankId: string;
  date: string;
  amount: string;
  reason: string;
  note: string;
}

function ScheduleEditor({
  state,
  initial,
  mode,
  onSubmit,
  onClose,
}: {
  state: RootState;
  initial: ScheduleFormState;
  mode: { kind: "create" } | { kind: "edit"; schedule: Schedule } | { kind: "revise"; source: Schedule };
  onSubmit: (draft: ScheduleDraft) => boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ScheduleFormState>(initial);
  const isRevise = mode.kind === "revise";
  const editing = mode.kind === "edit" ? mode.schedule : undefined;
  const revisionOf = mode.kind === "revise" ? mode.source : undefined;

  const amount = Number(form.amount);
  const draft: ScheduleDraft = {
    tankId: form.tankId,
    date: form.date,
    amountLiters: amount,
    revisionReason: form.reason,
    note: form.note,
  };

  // 弹窗内实时预检：让鱼缸、日期、缺口、触发规则在保存前就可见
  const preview = useMemo(
    () =>
      form.tankId && form.date && Number.isFinite(amount) && amount > 0
        ? planScheduleChange(state, draft, editing?.id, revisionOf)
        : { ok: false, conflicts: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, form.tankId, form.date, form.amount, form.reason, editing?.id, revisionOf?.id]
  );

  const title =
    mode.kind === "create"
      ? "新增换水排程"
      : mode.kind === "edit"
        ? `调整未执行排程（R3 先释放再重算）`
        : `新建修订 · 原单 ${mode.source.id.slice(-4)} 已冻结`;

  const selectedTank = state.tanks.find((t) => t.id === form.tankId);
  const elig = form.tankId ? evaluateEligibility(state.tests, form.tankId) : undefined;
  const dayCap = form.date ? getCap(state.caps, form.date, state.defaultCap) : state.defaultCap;

  const set = (patch: Partial<ScheduleFormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal title={title} onClose={onClose}>
      {isRevise ? (
        <div className="revision-source">
          <p className="field-hint">
            已执行旧值（保留不可改）：{state.tanks.find((t) => t.id === revisionOf!.tankId)?.name} ·{" "}
            {revisionOf!.date} · {revisionOf!.amountLiters}L
          </p>
          {revisionOf!.revisionReason ? (
            <p className="field-hint">该旧单本身也是修订，原因：{revisionOf!.revisionReason}</p>
          ) : null}
        </div>
      ) : null}

      <div className="form-grid">
        <Field label="鱼缸">
          <select
            value={form.tankId}
            disabled={isRevise}
            onChange={(e) => set({ tankId: e.target.value })}
          >
            {state.tanks.map((t) => {
              const e = evaluateEligibility(state.tests, t.id);
              return (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.volumeLiters}L · {PRIORITY_LABEL[t.priority]}
                  {e.eligible ? "" : " · 禁排"}）
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="换水日期">
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field
          label="换水量（升）"
          hint={
            selectedTank
              ? `鱼缸登记水量 ${selectedTank.volumeLiters}L（R5）；当日共享额度 ${dayCap}L（R2）`
              : undefined
          }
        >
          <input
            type="number"
            min={1}
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field label="备注">
          <input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="可选" />
        </Field>
        {isRevise ? (
          <div className="form-grid full">
            <Field label="修订原因（必填，R4）" hint="旧排程及其数值会原样保留，可在修订链中回看">
              <input
                value={form.reason}
                onChange={(e) => set({ reason: e.target.value })}
                placeholder="例如 现场发现旧单换水口堵塞，实际未换够"
              />
            </Field>
          </div>
        ) : null}
      </div>

      {elig && !elig.eligible ? (
        <p className="form-warn">
          R1 拦截：{elig.reason}
          {form.tankId ? "" : ""}
        </p>
      ) : null}

      {preview.conflicts.length > 0 ? (
        <div className="form-conflicts">
          {preview.conflicts.map((c) => (
            <p key={c.key} className="form-conflict-row">
              <span className="conflict-rule">{c.rule}</span>
              {c.title} —— {c.detail}
              {typeof c.gapLiters === "number" ? `（缺口 ${c.gapLiters}L）` : ""}
            </p>
          ))}
        </div>
      ) : form.tankId && form.date && Number.isFinite(amount) && amount > 0 ? (
        <p className="form-ok">预检通过：按当前优先级重算可排入 {form.date} 的共享额度。</p>
      ) : null}

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button
          className="primary-action"
          disabled={!preview.ok}
          onClick={() => {
            if (onSubmit(draft)) onClose();
          }}
        >
          {isRevise ? "提交修订（保留旧值）" : "保存排程"}
        </button>
      </div>
    </Modal>
  );
}

function ScheduleCard({
  state,
  schedule,
  row,
  onEdit,
  onExecute,
  onDelete,
  onRevise,
}: {
  state: RootState;
  schedule: Schedule;
  row?: DayAllocation["rows"][number];
  onEdit: (s: Schedule) => void;
  onExecute: (id: string) => void;
  onDelete: (id: string) => void;
  onRevise: (s: Schedule) => void;
}) {
  const tank = state.tanks.find((t) => t.id === schedule.tankId);
  const elig = tank ? evaluateEligibility(state.tests, tank.id) : undefined;
  const over = tank ? schedule.amountLiters > tank.volumeLiters : false;
  const unfitted = row ? !row.fits : false;

  return (
    <article
      className={`sched-card sched-${schedule.status}${unfitted && schedule.status === "pending" ? " over" : ""}${
        schedule.revisionOfId ? " is-revision" : ""
      }`}
    >
      <div className="sched-main">
        <div className="sched-title">
          <h4>{tank?.name ?? schedule.tankId}</h4>
          {tank ? <PriorityBadge priority={tank.priority} /> : null}
          <span className={`badge badge-status-${schedule.status}`}>{STATUS_LABEL[schedule.status]}</span>
          {schedule.revisionOfId ? <span className="badge badge-revision">修订单</span> : null}
          {unfitted && schedule.status === "pending" ? <span className="badge badge-unfitted">放不下</span> : null}
          {elig && !elig.eligible && schedule.status === "pending" ? (
            <span className="badge badge-blocked">R1 禁排</span>
          ) : null}
          {over ? <span className="badge badge-blocked">R5 超水量</span> : null}
        </div>
        <p className="sched-amount">
          <strong>{schedule.amountLiters}L</strong>
          {tank ? <span> / 缸容量 {tank.volumeLiters}L</span> : null}
        </p>
        {schedule.note ? <p className="sched-note">{schedule.note}</p> : null}
        {schedule.revisionOfId ? (
          <p className="sched-revision">
            修订自 {schedule.revisionOfId.slice(-6)} · 原因：{schedule.revisionReason}
          </p>
        ) : null}
        {schedule.status === "executed" && schedule.executedAt ? (
          <p className="sched-frozen">已执行冻结，旧值保留；如需更正请带原因新建修订（R4）。</p>
        ) : null}
      </div>
      <div className="sched-actions">
        {schedule.status === "pending" ? (
          <>
            <button onClick={() => onEdit(schedule)}>调整</button>
            <button className="primary-action" onClick={() => onExecute(schedule.id)}>
              标记已执行
            </button>
            <button className="link-danger" onClick={() => onDelete(schedule.id)}>
              删除
            </button>
          </>
        ) : (
          <button onClick={() => onRevise(schedule)}>带原因修订</button>
        )}
      </div>
    </article>
  );
}

function CapEditor({
  state,
  date,
  onClose,
  onSubmit,
}: {
  state: RootState;
  date: string | null;
  onClose: () => void;
  onSubmit: (cap: number) => boolean;
}) {
  const current = date ? getCap(state.caps, date, state.defaultCap) : state.defaultCap;
  const [value, setValue] = useState(String(current));
  const cap = Number(value);
  const valid = Number.isFinite(cap) && cap >= 0;

  return (
    <Modal title={date ? `设置 ${date} 专属额度` : "设置默认每日额度"} onClose={onClose}>
      <div className="form-grid">
        <Field label="每日共享换水额度（升）" hint="下调会立即按优先级重算所有未执行占用，超额将拒绝保存（R2）">
          <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      {date ? <p className="field-hint">缺省回落默认额度 {state.defaultCap}L。</p> : null}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button
          className="primary-action"
          disabled={!valid}
          onClick={() => {
            if (onSubmit(cap)) onClose();
          }}
        >
          保存额度
        </button>
      </div>
    </Modal>
  );
}

export function ScheduleBoard({
  state,
  allocations,
  onSave,
  onExecute,
  onDelete,
  onSetCap,
}: {
  state: RootState;
  allocations: Map<string, DayAllocation>;
  onSave: (draft: ScheduleDraft, editingId?: string, revisionOf?: Schedule) => boolean;
  onExecute: (id: string) => void;
  onDelete: (id: string) => boolean;
  onSetCap: (date: string | null, cap: number) => boolean;
}) {
  const [editor, setEditor] =
    useState<{ mode: { kind: "create" } | { kind: "edit"; schedule: Schedule } | { kind: "revise"; source: Schedule }; initial: ScheduleFormState } | null>(
      null
    );
  const [capDate, setCapDate] = useState<string | null | undefined>(undefined);

  const dates = useMemo(() => {
    const all = new Set<string>(state.schedules.map((s) => s.date));
    return [...all].sort();
  }, [state.schedules]);

  const blankForm = (): ScheduleFormState => ({
    tankId: state.tanks.find((t) => evaluateEligibility(state.tests, t.id).eligible)?.id ?? state.tanks[0]?.id ?? "",
    date: todayISO(),
    amount: "60",
    reason: "",
    note: "",
  });

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>换水排程台</p>
          <h2>按日期排程 · 共享水量上限 · 优先级占用</h2>
        </div>
        <div className="heading-actions">
          <button onClick={() => setCapDate(null)}>默认额度 {state.defaultCap}L</button>
          <button className="primary-action" onClick={() => setEditor({ mode: { kind: "create" }, initial: blankForm() })}>
            新增换水
          </button>
        </div>
      </div>

      <div className="day-list">
        {dates.map((date) => {
          const alloc = allocations.get(date);
          if (!alloc) return null;
          const ratio = alloc.capLiters > 0 ? Math.min(1, alloc.usedLiters / alloc.capLiters) : alloc.usedLiters > 0 ? 1 : 0;
          const daySchedules = state.schedules
            .filter((s) => s.date === date)
            .sort((a, b) => {
              if (a.status !== b.status) return a.status === "executed" ? -1 : 1;
              const ra = alloc.rows.find((r) => r.scheduleId === a.id);
              const rb = alloc.rows.find((r) => r.scheduleId === b.id);
              return (ra ? alloc.rows.indexOf(ra) : 99) - (rb ? alloc.rows.indexOf(rb) : 99);
            });
          return (
            <article key={date} className="day-card">
              <header className="day-head">
                <div>
                  <h3>{date}</h3>
                  <p>
                    已执行冻结 {alloc.executedLiters}L · 未执行占用 {alloc.pendingFittedLiters}L · 剩余 {alloc.freeLiters}L
                  </p>
                </div>
                <div className="day-cap">
                  <div className="cap-line">
                    <div className="cap-bar">
                      <div
                        className={`cap-fill${ratio >= 1 ? " full" : ratio > 0.8 ? " hot" : ""}`}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <strong>
                      {alloc.usedLiters}/{alloc.capLiters}L
                    </strong>
                  </div>
                  <button onClick={() => setCapDate(date)}>调整当日额度</button>
                </div>
              </header>
              <div className="sched-list">
                {daySchedules.map((s) => (
                  <ScheduleCard
                    key={s.id}
                    state={state}
                    schedule={s}
                    row={alloc.rows.find((r) => r.scheduleId === s.id)}
                    onEdit={(sc) =>
                      setEditor({
                        mode: { kind: "edit", schedule: sc },
                        initial: {
                          tankId: sc.tankId,
                          date: sc.date,
                          amount: String(sc.amountLiters),
                          reason: sc.revisionReason ?? "",
                          note: sc.note ?? "",
                        },
                      })
                    }
                    onExecute={onExecute}
                    onDelete={onDelete}
                    onRevise={(sc) =>
                      setEditor({
                        mode: { kind: "revise", source: sc },
                        initial: {
                          tankId: sc.tankId,
                          date: sc.date,
                          amount: String(sc.amountLiters),
                          reason: "",
                          note: "",
                        },
                      })
                    }
                  />
                ))}
              </div>
            </article>
          );
        })}
        {dates.length === 0 ? <p className="empty-hint">还没有排程，点击「新增换水」开始。</p> : null}
      </div>

      {editor ? (
        <ScheduleEditor
          state={state}
          mode={editor.mode}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSubmit={(draft) => {
            if (editor.mode.kind === "edit") return onSave(draft, editor.mode.schedule.id);
            if (editor.mode.kind === "revise") return onSave(draft, undefined, editor.mode.source);
            return onSave(draft);
          }}
        />
      ) : null}

      {capDate !== undefined ? (
        <CapEditor
          state={state}
          date={capDate}
          onClose={() => setCapDate(undefined)}
          onSubmit={(cap) => onSetCap(capDate, cap)}
        />
      ) : null}
    </section>
  );
}

export { RULES };
