import type { AllocationConflict } from "../scheduler/types";

const TYPE_LABEL: Record<AllocationConflict["type"], string> = {
  "tank-ineligible": "准入冲突",
  quota: "额度冲突",
  "over-capacity": "水量超限",
  frozen: "冻结/修订",
};

const TYPE_CLASS: Record<AllocationConflict["type"], string> = {
  "tank-ineligible": "conflict-r1",
  quota: "conflict-r2",
  "over-capacity": "conflict-r5",
  frozen: "conflict-r4",
};

function ConflictCard({ c }: { c: AllocationConflict }) {
  return (
    <article className={`conflict-card ${TYPE_CLASS[c.type]}`}>
      <div className="conflict-top">
        <span className="conflict-rule">{c.rule}</span>
        <span className="conflict-type">{TYPE_LABEL[c.type]}</span>
        <strong>{c.title}</strong>
      </div>
      <p>{c.detail}</p>
      <dl className="conflict-meta">
        {c.tankName ? (
          <div>
            <dt>鱼缸</dt>
            <dd>{c.tankName}</dd>
          </div>
        ) : null}
        {c.date ? (
          <div>
            <dt>日期</dt>
            <dd>{c.date}</dd>
          </div>
        ) : null}
        {typeof c.gapLiters === "number" ? (
          <div>
            <dt>缺口</dt>
            <dd className="gap">{c.gapLiters}L</dd>
          </div>
        ) : null}
        <div>
          <dt>触发规则</dt>
          <dd>{c.rule}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ConflictPanel({
  live,
  rejected,
  onDismissRejected,
}: {
  live: AllocationConflict[];
  rejected: AllocationConflict[];
  onDismissRejected: () => void;
}) {
  const empty = live.length === 0 && rejected.length === 0;
  return (
    <section className="panel conflicts-panel">
      <div className="section-heading">
        <div>
          <p>一致性校验</p>
          <h2>冲突清单</h2>
        </div>
        {rejected.length > 0 ? (
          <button onClick={onDismissRejected}>清除本次操作提示</button>
        ) : null}
      </div>

      {empty ? (
        <div className="conflict-empty">
          <strong>无冲突</strong>
          <p>鱼缸登记、检测状态、日期额度占用与修订链当前全部一致，刷新后仍按数据实时重算。</p>
        </div>
      ) : (
        <div className="conflict-list">
          {rejected.map((c) => (
            <div key={`rejected:${c.key}`} className="conflict-group">
              <p className="conflict-group-label">本次操作被拦截（未写入）</p>
              <ConflictCard c={c} />
            </div>
          ))}
          {live.map((c) => (
            <div key={`live:${c.key}`} className="conflict-group">
              <p className="conflict-group-label">现存冲突（由当前数据推导）</p>
              <ConflictCard c={c} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
