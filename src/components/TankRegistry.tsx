import { useState } from "react";
import {
  PRIORITY_LABEL,
  VERDICT_LABEL,
  evaluateEligibility,
  latestTestOf,
  recoveredAfterAbnormal,
  todayISO,
} from "../scheduler/rules";
import type { Priority, RootState, Tank, Verdict, WaterTest } from "../scheduler/types";
import type { TankDraft, TestDraft } from "../scheduler/store";
import { Field, Modal, PriorityBadge, VerdictBadge } from "./ui";

const TANK_KINDS = ["草缸", "海缸", "三湖缸", "繁殖缸"];
const VERDICTS: Verdict[] = ["ok", "watch", "abnormal"];
const PRIORITIES: Priority[] = ["high", "normal", "low"];

function EligibilityLine({ state, tank }: { state: RootState; tank: Tank }) {
  const elig = evaluateEligibility(state.tests, tank.id);
  const recovered = recoveredAfterAbnormal(state.tests, tank.id);
  if (elig.eligible) {
    return (
      <p className={`tank-elig ok${elig.verdict === "watch" ? " watch" : ""}`}>
        <i className="dot dot-ok" />
        准予排换水 · 最近检测 {elig.latestTestDate} · {elig.verdict ? VERDICT_LABEL[elig.verdict] : ""}
        {recovered ? "（异常后已复测合格）" : ""}
      </p>
    );
  }
  return (
    <p className="tank-elig blocked">
      <i className="dot dot-danger" />
      禁止排换水 · {elig.reason}
    </p>
  );
}

export function TankRegistry({
  state,
  onAddTank,
  onUpdateTank,
  onRemoveTank,
  tankRemovable,
  onAddTest,
  onRemoveTest,
}: {
  state: RootState;
  onAddTank: (draft: TankDraft) => void;
  onUpdateTank: (tankId: string, patch: Partial<TankDraft>) => void;
  onRemoveTank: (tankId: string) => boolean;
  tankRemovable: (tankId: string) => boolean;
  onAddTest: (draft: TestDraft) => void;
  onRemoveTest: (testId: string) => void;
}) {
  const [tankOpen, setTankOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTankId, setTestTankId] = useState(state.tanks[0]?.id ?? "");

  const [name, setName] = useState("");
  const [kind, setKind] = useState(TANK_KINDS[0]);
  const [volume, setVolume] = useState("120");
  const [priority, setPriority] = useState<Priority>("normal");

  const [testDate, setTestDate] = useState(todayISO());
  const [ph, setPh] = useState("");
  const [ammonia, setNitrogen] = useState("");
  const [nitrite, setNitrite] = useState("");
  const [nitrate, setNitrate] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("ok");
  const [testNote, setTestNote] = useState("");

  const submitTank = () => {
    const v = Number(volume);
    if (!name.trim() || !Number.isFinite(v) || v <= 0) return;
    onAddTank({ name, kind, volumeLiters: v, priority });
    setName("");
    setVolume("120");
    setPriority("normal");
    setTankOpen(false);
  };

  const numOrNull = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };

  const submitTest = () => {
    if (!testTankId || !testDate) return;
    onAddTest({
      tankId: testTankId,
      date: testDate,
      ph: numOrNull(ph),
      ammonia: numOrNull(ammonia),
      nitrite: numOrNull(nitrite),
      nitrate: numOrNull(nitrate),
      verdict,
      note: testNote,
    });
    setPh("");
    setNitrogen("");
    setNitrite("");
    setNitrate("");
    setTestNote("");
    setTestOpen(false);
  };

  const openTestFor = (tankId: string) => {
    setTestTankId(tankId);
    setTestDate(todayISO());
    setTestOpen(true);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>鱼缸登记</p>
          <h2>水量 · 检测状态 · 维护优先级</h2>
        </div>
        <div className="heading-actions">
          <button onClick={() => setTestOpen(true)} disabled={state.tanks.length === 0}>
            录入检测
          </button>
          <button className="primary-action" onClick={() => setTankOpen(true)}>
            登记鱼缸
          </button>
        </div>
      </div>

      <div className="tank-list">
        {state.tanks.map((tank) => {
          const latest = latestTestOf(state.tests, tank.id);
          const tankTests = state.tests
            .filter((t) => t.tankId === tank.id)
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
          return (
            <article key={tank.id} className="tank-card">
              <div className="tank-head">
                <div>
                  <h3>{tank.name}</h3>
                  <p className="tank-sub">
                    {tank.kind} · 登记水量 <strong>{tank.volumeLiters}L</strong>
                  </p>
                </div>
                <PriorityBadge priority={tank.priority} />
              </div>

              <EligibilityLine state={state} tank={tank} />

              <div className="tank-latest">
                {latest ? (
                  <div className="test-summary">
                    <VerdictBadge verdict={latest.verdict} />
                    <span>
                      最近检测 {latest.date}：pH {latest.ph ?? "—"} · 氨氮 {latest.ammonia ?? "—"} · 亚硝酸盐{" "}
                      {latest.nitrite ?? "—"} · 硝酸盐 {latest.nitrate ?? "—"} mg/L
                    </span>
                  </div>
                ) : (
                  <p className="no-test">无检测记录，不能排换水</p>
                )}
                {latest?.note ? <p className="test-note">备注：{latest.note}</p> : null}
              </div>

              <details className="test-history">
                <summary>检测记录（{tankTests.length}）· 优先级/水量内联调整</summary>
                <div className="inline-edit">
                  <label>
                    水量 L
                    <input
                      type="number"
                      min={1}
                      defaultValue={tank.volumeLiters}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v > 0 && v !== tank.volumeLiters)
                          onUpdateTank(tank.id, { volumeLiters: v });
                      }}
                    />
                  </label>
                  <label>
                    优先级
                    <select
                      defaultValue={tank.priority}
                      onChange={(e) => onUpdateTank(tank.id, { priority: e.target.value as Priority })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <ul className="test-list">
                  {tankTests.map((t: WaterTest) => (
                    <li key={t.id}>
                      <span className="test-date">{t.date}</span>
                      <VerdictBadge verdict={t.verdict} />
                      <span className="test-vals">
                        pH {t.ph ?? "—"} / NH₃ {t.ammonia ?? "—"} / NO₂ {t.nitrite ?? "—"} / NO₃{" "}
                        {t.nitrate ?? "—"}
                      </span>
                      {t.note ? <span className="test-note-inline">{t.note}</span> : null}
                      <button className="link-danger" onClick={() => onRemoveTest(t.id)}>
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="tank-card-actions">
                  <button onClick={() => openTestFor(tank.id)}>为该缸复测</button>
                  <button
                    className="link-danger"
                    disabled={!tankRemovable(tank.id)}
                    title={tankRemovable(tank.id) ? "删除鱼缸" : "存在检测或排程引用，不能删除"}
                    onClick={() => onRemoveTank(tank.id)}
                  >
                    删除鱼缸
                  </button>
                </div>
              </details>
            </article>
          );
        })}
        {state.tanks.length === 0 ? <p className="empty-hint">还没有鱼缸，先登记一个。</p> : null}
      </div>

      {tankOpen ? (
        <Modal title="登记鱼缸" onClose={() => setTankOpen(false)}>
          <div className="form-grid">
            <Field label="鱼缸名称">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 草缸A" />
            </Field>
            <Field label="类型">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {TANK_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="登记水量（升）" hint="单次换水量不得超过该值（R5）">
              <input type="number" min={1} value={volume} onChange={(e) => setVolume(e.target.value)} />
            </Field>
            <Field label="维护优先级" hint="同日额度不足时，高优先级先占用（R2）">
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="modal-actions">
            <button onClick={() => setTankOpen(false)}>取消</button>
            <button
              className="primary-action"
              onClick={submitTank}
              disabled={!name.trim() || !(Number(volume) > 0)}
            >
              保存登记
            </button>
          </div>
        </Modal>
      ) : null}

      {testOpen ? (
        <Modal title="录入水质检测" onClose={() => setTestOpen(false)}>
          <div className="form-grid">
            <Field label="鱼缸">
              <select value={testTankId} onChange={(e) => setTestTankId(e.target.value)}>
                {state.tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（{t.volumeLiters}L · {PRIORITY_LABEL[t.priority]}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="检测日期">
              <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
            </Field>
            <Field label="pH">
              <input type="number" step="0.1" value={ph} onChange={(e) => setPh(e.target.value)} placeholder="6.5–8.3" />
            </Field>
            <Field label="氨氮 mg/L">
              <input type="number" step="0.01" value={ammonia} onChange={(e) => setNitrogen(e.target.value)} placeholder="≤0.02" />
            </Field>
            <Field label="亚硝酸盐 mg/L">
              <input type="number" step="0.01" value={nitrite} onChange={(e) => setNitrite(e.target.value)} placeholder="≤0.1" />
            </Field>
            <Field label="硝酸盐 mg/L">
              <input type="number" step="1" value={nitrate} onChange={(e) => setNitrate(e.target.value)} placeholder="≤40" />
            </Field>
            <Field label="检测结论" hint="异常结论会触发 R1：复测合格前禁排换水">
              <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
                {VERDICTS.map((v) => (
                  <option key={v} value={v}>
                    {VERDICT_LABEL[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="备注">
              <input value={testNote} onChange={(e) => setTestNote(e.target.value)} placeholder="处置建议" />
            </Field>
          </div>
          <div className="modal-actions">
            <button onClick={() => setTestOpen(false)}>取消</button>
            <button className="primary-action" onClick={submitTest} disabled={!testTankId || !testDate}>
              保存检测
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
