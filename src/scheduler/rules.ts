// 换水排程台 —— 纯规则引擎（规则层）
// 不依赖 React / 存储，所有判断都可在刷新后由数据重新推导，保证一致性。
import type {
  AllocationConflict,
  AllocationRow,
  CapOverride,
  DayAllocation,
  EligibilityResult,
  PlanResult,
  Priority,
  RootState,
  Schedule,
  ScheduleDraft,
  Tank,
  Verdict,
  WaterTest,
} from "./types";

/** 规则清单（页面侧栏与冲突提示共用这一份，规则只有一个事实来源） */
export const RULES = [
  {
    code: "R1",
    text: "准入：最近一次检测为异常且之后没有复测合格的鱼缸，不能排换水；无检测记录同样禁排。",
  },
  {
    code: "R2",
    text: "共享额度：同一日期的换水总额不得超过当日上限；高优先级先占，同级按登记时间先占。",
  },
  {
    code: "R3",
    text: "调整：修改未执行项时先释放其原占用额度，再按优先级重算，任何方案都不能超额。",
  },
  {
    code: "R4",
    text: "冻结与修订：已执行排程冻结不可改，只能带原因新建修订，旧值完整保留并串联修订链。",
  },
  {
    code: "R5",
    text: "水量上限：单次换水量不得超过鱼缸登记水量。",
  },
] as const;

/** 检测指标参考阈值，仅用于人工结论建议，不做硬性拦截 */
export const TEST_THRESHOLDS = {
  ph: { min: 6.5, max: 8.3 },
  ammonia: { max: 0.02 }, // 氨氮 mg/L
  nitrite: { max: 0.1 }, // 亚硝酸盐 mg/L
  nitrate: { max: 40 }, // 硝酸盐 mg/L
} as const;

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "高优先级",
  normal: "普通",
  low: "低优先级",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  ok: "合格",
  watch: "关注",
  abnormal: "异常",
};

export const STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "未执行",
  executed: "已执行·冻结",
};

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function latestTestOf(tests: WaterTest[], tankId: string): WaterTest | undefined {
  return tests
    .filter((t) => t.tankId === tankId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))[0];
}

/**
 * R1 准入判定：
 * - 无检测记录 => 不可排（状态未知，需先检测）
 * - 最近一次异常 => 不可排，必须之后复测合格
 * - 最近一次关注/合格 => 可排
 */
export function evaluateEligibility(
  tests: WaterTest[],
  tankId: string
): EligibilityResult {
  const latest = latestTestOf(tests, tankId);
  if (!latest) {
    return { eligible: false, reason: "尚无检测记录，需先完成一次水质检测" };
  }
  if (latest.verdict === "abnormal") {
    return {
      eligible: false,
      verdict: latest.verdict,
      latestTestDate: latest.date,
      reason: `最近检测（${latest.date}）为异常，复测合格前不能排换水`,
    };
  }
  return {
    eligible: true,
    verdict: latest.verdict,
    latestTestDate: latest.date,
  };
}

/** 异常之后是否已出现一次合格复测（页面解释用） */
export function recoveredAfterAbnormal(tests: WaterTest[], tankId: string): boolean {
  const ordered = tests
    .filter((t) => t.tankId === tankId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  let abnormalSeen = false;
  for (const t of ordered) {
    if (t.verdict === "abnormal") abnormalSeen = true;
    if (abnormalSeen && t.verdict === "ok") return true;
  }
  return false;
}

export function getCap(caps: CapOverride[], date: string, fallback: number): number {
  const hit = caps.find((c) => c.date === date);
  return hit ? hit.capLiters : fallback;
}

/**
 * 收集当前"无效"的未执行排程：鱼缸缺失 / R1 准入未过 / R5 超缸容量。
 * 这些单据不参与额度占位（不能执行就不应抢占他人额度），
 * 但保留在数据中并由 liveConflicts 挂出，待复测或修正后重新进入分配。
 * 已执行项是历史事实，永远计入占用，不在此列。
 */
export function invalidPendingIds(
  state: Pick<RootState, "schedules" | "tanks" | "tests">
): Set<string> {
  const out = new Set<string>();
  for (const s of state.schedules) {
    if (s.status !== "pending") continue;
    const tank = state.tanks.find((t) => t.id === s.tankId);
    if (!tank) {
      out.add(s.id);
      continue;
    }
    if (!evaluateEligibility(state.tests, tank.id).eligible) out.add(s.id);
    if (s.amountLiters > tank.volumeLiters) out.add(s.id);
  }
  return out;
}

/**
 * 单日额度分配（R2/R3 的核心）：
 * 已执行项先据实占用并冻结；未执行项按 优先级 -> 登记时间 -> id 排序，
 * 剩余额度逐项贪心放入，放不下即为冲突项（不占用额度，如实给出缺口）。
 * exclude 中的未执行项（准入未过/超水量）不参与占位。
 */
export function dayAllocation(
  state: Pick<RootState, "schedules" | "caps" | "defaultCap" | "tanks">,
  date: string,
  exclude?: ReadonlySet<string>
): DayAllocation {
  const cap = getCap(state.caps, date, state.defaultCap);
  const dayItems = state.schedules.filter((s) => s.date === date);
  const tankMap = new Map(state.tanks.map((t) => [t.id, t]));
  const priorityOf = (s: Schedule): Priority => tankMap.get(s.tankId)?.priority ?? "normal";

  const executed = dayItems
    .filter((s) => s.status === "executed")
    .sort((a, b) => (a.executedAt ?? a.createdAt) - (b.executedAt ?? b.createdAt));
  const pending = dayItems
    .filter((s) => s.status === "pending" && !exclude?.has(s.id))
    .sort((a, b) => {
      const pr = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
      if (pr !== 0) return pr;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : 1;
    });

  const rows: AllocationRow[] = [];
  let used = 0;

  // 已执行：冻结占用，即使超出也照常计入（修订只新增、不抹除旧事实）
  for (const s of executed) {
    const fits = used + s.amountLiters <= cap;
    rows.push({
      scheduleId: s.id,
      tankId: s.tankId,
      amountLiters: s.amountLiters,
      priority: priorityOf(s),
      status: "executed",
      fits,
      gapLiters: fits ? 0 : used + s.amountLiters - cap,
    });
    used += s.amountLiters;
  }

  const executedLiters = used;

  // 未执行：贪心占位
  let pendingFitted = 0;
  for (const s of pending) {
    const fits = used + s.amountLiters <= cap;
    rows.push({
      scheduleId: s.id,
      tankId: s.tankId,
      amountLiters: s.amountLiters,
      priority: priorityOf(s),
      status: "pending",
      fits,
      gapLiters: fits ? 0 : used + s.amountLiters - cap,
    });
    if (fits) {
      used += s.amountLiters;
      pendingFitted += s.amountLiters;
    }
  }

  return {
    date,
    capLiters: cap,
    executedLiters,
    pendingFittedLiters: pendingFitted,
    usedLiters: used,
    freeLiters: Math.max(0, cap - used),
    rows,
  };
}

export function allocationByDate(
  state: Pick<RootState, "schedules" | "caps" | "defaultCap" | "tanks" | "tests">
): Map<string, DayAllocation> {
  const map = new Map<string, DayAllocation>();
  const dates = new Set<string>(state.schedules.map((s) => s.date));
  const exclude = invalidPendingIds(state);
  for (const date of dates) map.set(date, dayAllocation(state, date, exclude));
  return map;
}

function tankName(tanks: Tank[], id: string): string {
  return tanks.find((t) => t.id === id)?.name ?? id;
}

function quotaConflict(
  tanks: Tank[],
  s: Schedule,
  date: string,
  gap: number,
  rule: "R2" | "R3"
): AllocationConflict {
  return {
    key: `quota:${s.id}:${date}`,
    type: "quota",
    tankId: s.tankId,
    tankName: tankName(tanks, s.tankId),
    date,
    gapLiters: gap,
    rule,
    title: `额度缺口 ${gap}L`,
    detail: `${tankName(tanks, s.tankId)} 在 ${date} 换水 ${s.amountLiters}L，按优先级重算后超出当日共享额度 ${gap}L`,
  };
}

/** 跨全部日期收集现存冲突（刷新后仍一致：全部由当前数据推导） */
export function liveConflicts(
  state: Pick<RootState, "schedules" | "caps" | "defaultCap" | "tanks" | "tests">
): AllocationConflict[] {
  const conflicts: AllocationConflict[] = [];
  const allocations = allocationByDate(state);
  const scheduleMap = new Map(state.schedules.map((s) => [s.id, s]));

  for (const alloc of allocations.values()) {
    for (const row of alloc.rows) {
      if (!row.fits) {
        const s = scheduleMap.get(row.scheduleId);
        if (s) {
          // 已执行的历史冻结项是既有事实，按 R4 处理，不作为待解决额度告警；
          // 其后续修订会以未执行项身份进入分配并正常受 R2 约束。
          if (s.status === "pending") {
            conflicts.push(quotaConflict(state.tanks, s, alloc.date, row.gapLiters, "R2"));
          }
        }
      }
    }
  }

  for (const s of state.schedules) {
    if (s.status !== "pending") continue;
    const tank = state.tanks.find((t) => t.id === s.tankId);
    if (!tank) {
      conflicts.push({
        key: `tank-missing:${s.id}`,
        type: "tank-ineligible",
        tankId: s.tankId,
        date: s.date,
        rule: "R1",
        title: "鱼缸登记缺失",
        detail: `排程 ${s.id} 关联的鱼缸已不存在`,
      });
      continue;
    }
    const elig = evaluateEligibility(state.tests, tank.id);
    if (!elig.eligible) {
      conflicts.push({
        key: `ineligible:${s.id}`,
        type: "tank-ineligible",
        tankId: tank.id,
        tankName: tank.name,
        date: s.date,
        rule: "R1",
        title: "检测准入未通过",
        detail: `${tank.name}（${s.date} 换水 ${s.amountLiters}L）：${elig.reason}`,
      });
    }
    if (s.amountLiters > tank.volumeLiters) {
      conflicts.push({
        key: `over-cap:${s.id}`,
        type: "over-capacity",
        tankId: tank.id,
        tankName: tank.name,
        date: s.date,
        gapLiters: s.amountLiters - tank.volumeLiters,
        rule: "R5",
        title: `超出鱼缸水量 ${s.amountLiters - tank.volumeLiters}L`,
        detail: `${tank.name} 登记水量 ${tank.volumeLiters}L，本单 ${s.amountLiters}L，超出 ${s.amountLiters - tank.volumeLiters}L`,
      });
    }
  }

  return dedupeConflicts(conflicts);
}

export function dedupeConflicts(list: AllocationConflict[]): AllocationConflict[] {
  const map = new Map<string, AllocationConflict>();
  for (const c of list) if (!map.has(c.key)) map.set(c.key, c);
  return [...map.values()];
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + "T00:00:00").getTime());
}

/**
 * 新增 / 编辑 / 修订一条排程的预检（R1、R4、R5 + R3 释放后重算）。
 * editingId 为空表示新建；非空表示调整未执行项 —— 重算时先剔除原单（释放额度）。
 */
export function planScheduleChange(
  state: RootState,
  draft: ScheduleDraft,
  editingId?: string,
  revisionOf?: Schedule
): PlanResult {
  const conflicts: AllocationConflict[] = [];
  const tank = state.tanks.find((t) => t.id === draft.tankId);

  if (!tank) {
    return {
      ok: false,
      conflicts: [
        {
          key: "plan:no-tank",
          type: "tank-ineligible",
          rule: "R1",
          title: "请选择鱼缸",
          detail: "必须选择已登记水量和优先级的鱼缸",
        },
      ],
    };
  }
  if (!isValidDate(draft.date)) {
    return {
      ok: false,
      conflicts: [
        {
          key: "plan:bad-date",
          type: "quota",
          rule: "R2",
          title: "日期无效",
          detail: "请选择有效的换水日期",
        },
      ],
    };
  }
  if (!Number.isFinite(draft.amountLiters) || draft.amountLiters <= 0) {
    return {
      ok: false,
      conflicts: [
        {
          key: "plan:bad-amount",
          type: "over-capacity",
          rule: "R5",
          title: "换水量无效",
          detail: "换水量必须为大于 0 的升数",
        },
      ],
    };
  }

  // R4：已执行排程不能直接改
  if (editingId) {
    const existing = state.schedules.find((s) => s.id === editingId);
    if (existing?.status === "executed") {
      conflicts.push({
        key: `frozen:${existing.id}`,
        type: "frozen",
        tankId: existing.tankId,
        tankName: tankName(state.tanks, existing.tankId),
        date: existing.date,
        rule: "R4",
        title: "已执行排程已冻结",
        detail: "已执行项只能带原因新建修订，旧值保留，不能直接编辑",
      });
    }
  }

  // 修订必须带原因
  if (revisionOf && !(draft.revisionReason && draft.revisionReason.trim())) {
    conflicts.push({
      key: "plan:revision-reason",
      type: "frozen",
      tankId: draft.tankId,
      tankName: tank.name,
      date: draft.date,
      rule: "R4",
      title: "修订原因必填",
      detail: "对已执行排程做修订时，必须填写修订原因，旧值会保留在修订链中",
    });
  }

  // R1：检测准入
  const elig = evaluateEligibility(state.tests, draft.tankId);
  if (!elig.eligible) {
    conflicts.push({
      key: `plan-ineligible:${draft.tankId}`,
      type: "tank-ineligible",
      tankId: draft.tankId,
      tankName: tank.name,
      date: draft.date,
      rule: "R1",
      title: "检测准入未通过",
      detail: `${tank.name}：${elig.reason}`,
    });
  }

  // R5：不得超过鱼缸登记水量
  if (draft.amountLiters > tank.volumeLiters) {
    conflicts.push({
      key: "plan:over-capacity",
      type: "over-capacity",
      tankId: draft.tankId,
      tankName: tank.name,
      date: draft.date,
      gapLiters: draft.amountLiters - tank.volumeLiters,
      rule: "R5",
      title: `超出鱼缸水量 ${draft.amountLiters - tank.volumeLiters}L`,
      detail: `${tank.name} 登记水量 ${tank.volumeLiters}L，本单 ${draft.amountLiters}L`,
    });
  }

  // R2/R3：先释放编辑项原额度，再把新草稿当未执行项放入全局重算；
  // 任何排程（候选自己或被挤掉的低优先级单）放不下都拒绝，保证方案整体不超额。
  if (conflicts.length === 0) {
    const quotaRule = editingId ? "R3" : "R2";
    const candidate: Schedule = {
      id: editingId ?? "candidate",
      tankId: draft.tankId,
      date: draft.date,
      amountLiters: draft.amountLiters,
      status: "pending",
      createdAt: editingId
        ? state.schedules.find((s) => s.id === editingId)?.createdAt ?? Date.now()
        : Date.now(),
      revisionOfId: revisionOf?.id,
      chainRootId: revisionOf?.chainRootId ?? revisionOf?.id,
      revisionReason: revisionOf ? draft.revisionReason?.trim() : undefined,
      note: draft.note,
    };
    const rebase = state.schedules.filter((s) => s.id !== editingId);
    const simulated: RootState = {
      ...state,
      schedules: [...rebase, candidate],
    };
    // 重算时其他仍无效的单据先让出额度；候选自身若无效前面已拦截
    const exclude = invalidPendingIds(simulated);
    exclude.delete(candidate.id);
    const alloc = dayAllocation(simulated, draft.date, exclude);
    for (const row of alloc.rows) {
      if (row.fits || row.status !== "pending") continue;
      const owner =
        row.scheduleId === candidate.id
          ? candidate
          : simulated.schedules.find((s) => s.id === row.scheduleId);
      if (owner) conflicts.push(quotaConflict(simulated.tanks, owner, draft.date, row.gapLiters, quotaRule));
    }
  }

  return { ok: conflicts.length === 0, conflicts: dedupeConflicts(conflicts) };
}

/** 调整某日额度上限的预检：已执行项据实占用，未执行项重算后不得超额 */
export function planCapChange(
  state: RootState,
  date: string | null,
  newCap: number
): PlanResult {
  if (!Number.isFinite(newCap) || newCap < 0) {
    return {
      ok: false,
      conflicts: [
        {
          key: "cap:bad",
          type: "quota",
          rule: "R2",
          title: "额度无效",
          detail: "每日额度必须为不小于 0 的升数",
        },
      ],
    };
  }
  const simulated: RootState = date
    ? {
        ...state,
        caps: [
          ...state.caps.filter((c) => c.date !== date),
          { date, capLiters: newCap },
        ],
      }
    : { ...state, defaultCap: newCap };
  const exclude = invalidPendingIds(simulated);
  const conflicts: AllocationConflict[] = [];

  const affectedDates = new Set<string>();
  if (date) {
    affectedDates.add(date);
  } else {
    // 默认额度影响所有"未设专属额度"的日期
    for (const s of simulated.schedules) {
      if (s.status !== "pending") continue;
      if (simulated.caps.some((c) => c.date === s.date)) continue;
      affectedDates.add(s.date);
    }
  }

  for (const d of affectedDates) {
    const alloc = dayAllocation(simulated, d, exclude);
    for (const row of alloc.rows) {
      if (!row.fits && row.status === "pending") {
        const s = simulated.schedules.find((x) => x.id === row.scheduleId);
        if (s) conflicts.push(quotaConflict(simulated.tanks, s, alloc.date, row.gapLiters, "R2"));
      }
    }
  }
  return { ok: conflicts.length === 0, conflicts: dedupeConflicts(conflicts) };
}

/** 修订链一致性检查（刷新后自检：链不断、修订必须有原因） */
export function chainIntegrity(state: RootState): AllocationConflict[] {
  const byId = new Map(state.schedules.map((s) => [s.id, s]));
  const out: AllocationConflict[] = [];
  for (const s of state.schedules) {
    if (s.revisionOfId) {
      const parent = byId.get(s.revisionOfId);
      if (!parent) {
        out.push({
          key: `chain-broken:${s.id}`,
          type: "frozen",
          tankId: s.tankId,
          tankName: tankName(state.tanks, s.tankId),
          date: s.date,
          rule: "R4",
          title: "修订链断裂",
          detail: `排程 ${s.id} 声明修订自已删除的 ${s.revisionOfId}`,
        });
      } else if (!(s.revisionReason && s.revisionReason.trim())) {
        out.push({
          key: `chain-reason:${s.id}`,
          type: "frozen",
          tankId: s.tankId,
          tankName: tankName(state.tanks, s.tankId),
          date: s.date,
          rule: "R4",
          title: "修订缺少原因",
          detail: `排程 ${s.id} 是修订项但未保留修订原因`,
        });
      }
    }
  }
  return out;
}
