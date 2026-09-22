// 规则层: 每日共享额度占用 (R2)、单缸限量 (R3) 与冲突检测。
// 额度占用是纯派生值: 由排程实体实时重算, 不落库, 因此刷新后天然一致。

import type { AppState, Schedule } from "../data/types";
import { DAILY_CAP_LITERS, MAX_CHANGE_RATIO, PRIORITY_WEIGHT, RULE_TEXT, type RuleId } from "./constants";
import { checkEligibility } from "./tests";

/** 单缸单次换水上限 = 登记水量 × MAX_CHANGE_RATIO */
export function maxSingleChangeLiters(state: AppState, tankId: string): number {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return 0;
  return Math.floor(tank.volumeLiters * MAX_CHANGE_RATIO);
}

export interface Allocation {
  scheduleId: string;
  allocatedLiters: number; // 实占额度
  shortfallLiters: number; // 缺口 = 申请 - 实占
}

export interface DayLedger {
  date: string;
  cap: number;
  used: number;
  remaining: number;
  /** 按占用顺序排列: 已执行优先计入, 待执行按优先级抢占 */
  allocations: Allocation[];
}

export interface LedgerOptions {
  /** 先从占用中释放这些排程 (调整未执行项时释放原额度) */
  excludeIds?: ReadonlySet<string>;
  /** 再并入这些排程重算 (预览新排/调整后的占用) */
  extra?: Schedule[];
}

function byCreatedThenId(a: Schedule, b: Schedule): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * 计算某日额度台账:
 * 1. 已执行排程是既定事实, 按创建时间先计入;
 * 2. 待执行排程按 维护优先级(高→低) → 创建时间 抢占剩余额度;
 * 3. 占用永不超额, 申请超出剩余额度的部分记为缺口。
 */
export function buildDayLedger(state: AppState, date: string, opts?: LedgerOptions): DayLedger {
  const exclude = opts?.excludeIds ?? new Set<string>();
  const items = state.schedules
    .filter((s) => s.date === date && !s.superseded && !exclude.has(s.id))
    .concat(opts?.extra ?? []);

  const weightOf = (s: Schedule): number =>
    PRIORITY_WEIGHT[state.tanks.find((t) => t.id === s.tankId)?.priority ?? "low"];

  const executed = items.filter((s) => s.status === "executed").sort(byCreatedThenId);
  const planned = items
    .filter((s) => s.status === "planned")
    .sort((a, b) => weightOf(b) - weightOf(a) || byCreatedThenId(a, b));

  let remaining = DAILY_CAP_LITERS;
  const allocations: Allocation[] = [];
  for (const s of [...executed, ...planned]) {
    const take = Math.min(s.amountLiters, Math.max(0, remaining));
    allocations.push({
      scheduleId: s.id,
      allocatedLiters: take,
      shortfallLiters: s.amountLiters - take,
    });
    remaining -= take;
  }

  return {
    date,
    cap: DAILY_CAP_LITERS,
    used: DAILY_CAP_LITERS - Math.max(0, remaining),
    remaining: Math.max(0, remaining),
    allocations,
  };
}

/** 当前所有有额度占用的日期 (仅修订链最新版本占用额度) */
export function collectDates(state: AppState): string[] {
  const dates = new Set<string>();
  for (const s of state.schedules) {
    if (!s.superseded) dates.add(s.date);
  }
  return [...dates].sort();
}

export function buildLedgers(state: AppState): Map<string, DayLedger> {
  const map = new Map<string, DayLedger>();
  for (const date of collectDates(state)) {
    map.set(date, buildDayLedger(state, date));
  }
  return map;
}

export interface PlacementPreview {
  remainingBefore: number; // 放入前该日剩余额度
  shortfallLiters: number; // 放入后该项预计缺口
}

/** 预览某申请放入某日后的占用情况 (先释放 excludeId 原额度再重算) */
export function previewPlacement(
  state: AppState,
  input: { tankId: string; date: string; amountLiters: number; excludeId?: string; createdAt?: string }
): PlacementPreview {
  const excludeIds = new Set<string>(input.excludeId ? [input.excludeId] : []);
  const before = buildDayLedger(state, input.date, { excludeIds });
  const temp: Schedule = {
    id: "__preview__",
    tankId: input.tankId,
    date: input.date,
    amountLiters: input.amountLiters,
    status: "planned",
    superseded: false,
    revisionOf: null,
    revisionReason: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const after = buildDayLedger(state, input.date, { excludeIds, extra: [temp] });
  const alloc = after.allocations.find((a) => a.scheduleId === temp.id);
  return { remainingBefore: before.remaining, shortfallLiters: alloc?.shortfallLiters ?? 0 };
}

export interface Conflict {
  scheduleId: string;
  tankId: string;
  tankName: string;
  date: string;
  shortfallLiters: number; // 缺口 (L)
  ruleId: RuleId;
  rule: string; // 触发规则描述
}

/**
 * 冲突检测: 对待执行排程逐项核对 R1/R2/R3,
 * 输出鱼缸、日期、缺口与触发规则。已执行/已被修订的排程是冻结事实, 不再判冲突。
 */
export function detectConflicts(state: AppState): Conflict[] {
  const ledgers = buildLedgers(state);
  const allocOf = new Map<string, Allocation>();
  ledgers.forEach((ledger) => ledger.allocations.forEach((a) => allocOf.set(a.scheduleId, a)));

  const conflicts: Conflict[] = [];
  for (const s of state.schedules) {
    if (s.superseded || s.status !== "planned") continue;
    const tank = state.tanks.find((t) => t.id === s.tankId);
    if (!tank) continue;
    const base = { scheduleId: s.id, tankId: s.tankId, tankName: tank.name, date: s.date };

    const elig = checkEligibility(state, s.tankId);
    if (!elig.ok) {
      conflicts.push({ ...base, shortfallLiters: s.amountLiters, ruleId: "R1", rule: `${RULE_TEXT.R1} (${elig.reason})` });
    }

    const maxSingle = maxSingleChangeLiters(state, s.tankId);
    if (s.amountLiters > maxSingle) {
      conflicts.push({
        ...base,
        shortfallLiters: s.amountLiters - maxSingle,
        ruleId: "R3",
        rule: `${RULE_TEXT.R3} (上限 ${maxSingle}L)`,
      });
    }

    const alloc = allocOf.get(s.id);
    if (alloc && alloc.shortfallLiters > 0) {
      conflicts.push({ ...base, shortfallLiters: alloc.shortfallLiters, ruleId: "R2", rule: RULE_TEXT.R2 });
    }
  }

  return conflicts.sort(
    (a, b) => a.date.localeCompare(b.date) || a.ruleId.localeCompare(b.ruleId) || a.scheduleId.localeCompare(b.scheduleId)
  );
}
