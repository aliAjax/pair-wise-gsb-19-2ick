// 规则层: 全部写操作。纯函数, 输入旧状态返回新状态或错误, 不触碰存储与页面。

import type { AppState, Priority, Schedule } from "../data/types";
import { nextId } from "../data/ids";
import { checkEligibility, judgeTest } from "./tests";
import { detectConflicts, maxSingleChangeLiters } from "./allocation";

export type OpResult = { ok: true; state: AppState } | { ok: false; error: string };

const ok = (state: AppState): OpResult => ({ ok: true, state });
const err = (error: string): OpResult => ({ ok: false, error });

const now = () => new Date().toISOString();

export function registerTank(
  state: AppState,
  input: { name: string; kind: string; volumeLiters: number; priority: Priority }
): OpResult {
  const name = input.name.trim();
  if (!name) return err("鱼缸名称不能为空");
  if (!Number.isFinite(input.volumeLiters) || input.volumeLiters <= 0) return err("登记水量必须大于 0");
  const tank = {
    id: nextId("TK", state.tanks.map((t) => t.id)),
    name,
    kind: input.kind,
    volumeLiters: Math.round(input.volumeLiters),
    priority: input.priority,
  };
  return ok({ ...state, tanks: [...state.tanks, tank] });
}

export function addWaterTest(
  state: AppState,
  input: { tankId: string; date: string; ph: number; ammonia: number; nitrite: number; nitrate: number }
): OpResult {
  const tank = state.tanks.find((t) => t.id === input.tankId);
  if (!tank) return err("鱼缸不存在");
  if (!input.date) return err("检测日期不能为空");
  const { ph, ammonia, nitrite, nitrate } = input;
  if (![ph, ammonia, nitrite, nitrate].every(Number.isFinite)) return err("检测指标必须是数字");
  if (ph < 0 || ph > 14) return err("pH 需在 0–14 之间");
  if (ammonia < 0 || nitrite < 0 || nitrate < 0) return err("检测指标不能为负");
  const test = {
    id: nextId("WT", state.tests.map((t) => t.id)),
    tankId: input.tankId,
    date: input.date,
    ph,
    ammonia,
    nitrite,
    nitrate,
    result: judgeTest({ ph, ammonia, nitrite, nitrate }),
  };
  return ok({ ...state, tests: [...state.tests, test] });
}

function validatePlan(state: AppState, tankId: string, date: string, amountLiters: number): string | null {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return "鱼缸不存在";
  if (!date) return "请选择换水日期";
  if (!Number.isFinite(amountLiters) || amountLiters <= 0) return "换水量必须大于 0";
  // R3 硬校验
  const maxSingle = maxSingleChangeLiters(state, tankId);
  if (amountLiters > maxSingle) return `单次换水量超过登记水量 50% 上限 (${maxSingle}L), 触发 R3`;
  // R1 硬校验
  const elig = checkEligibility(state, tankId);
  if (!elig.ok) return `${tank.name} ${elig.reason}, 禁止排换水, 触发 R1`;
  return null;
}

/**
 * 新建排程。R1/R3 直接拒绝;
 * R2 不硬拦: 占用永不超额, 申请超出当日剩余额度的部分进入冲突列表记缺口。
 */
export function addSchedule(
  state: AppState,
  input: { tankId: string; date: string; amountLiters: number }
): OpResult {
  const invalid = validatePlan(state, input.tankId, input.date, input.amountLiters);
  if (invalid) return err(invalid);
  const schedule: Schedule = {
    id: nextId("SC", state.schedules.map((s) => s.id)),
    tankId: input.tankId,
    date: input.date,
    amountLiters: Math.round(input.amountLiters),
    status: "planned",
    superseded: false,
    revisionOf: null,
    revisionReason: null,
    createdAt: now(),
  };
  return ok({ ...state, schedules: [...state.schedules, schedule] });
}

/**
 * 调整未执行项: 先释放原额度再按新值重算。
 * 额度占用是派生值, 更新记录即完成释放与重算; 超额部分进冲突列表。
 */
export function adjustSchedule(
  state: AppState,
  scheduleId: string,
  input: { date: string; amountLiters: number }
): OpResult {
  const target = state.schedules.find((s) => s.id === scheduleId);
  if (!target) return err("排程不存在");
  if (target.superseded) return err("该排程已被修订取代并冻结, 不能调整");
  if (target.status === "executed") return err("已执行排程已冻结, 请通过修订变更");
  const invalid = validatePlan(state, target.tankId, input.date, input.amountLiters);
  if (invalid) return err(invalid);
  const schedules = state.schedules.map((s) =>
    s.id === scheduleId ? { ...s, date: input.date, amountLiters: Math.round(input.amountLiters) } : s
  );
  return ok({ ...state, schedules });
}

/** 执行排程: 存在未解冲突 (R1/R2/R3) 时不允许执行 */
export function executeSchedule(state: AppState, scheduleId: string): OpResult {
  const target = state.schedules.find((s) => s.id === scheduleId);
  if (!target) return err("排程不存在");
  if (target.superseded) return err("该排程已被修订取代, 不能执行");
  if (target.status !== "planned") return err("仅待执行排程可执行");
  const related = detectConflicts(state).filter((c) => c.scheduleId === scheduleId);
  if (related.length > 0) {
    return err(`存在未解冲突 (${related.map((c) => c.ruleId).join("/")}), 不能执行`);
  }
  const schedules = state.schedules.map((s) => (s.id === scheduleId ? { ...s, status: "executed" as const } : s));
  return ok({ ...state, schedules });
}

/**
 * 修订已执行排程: 旧版本冻结并保留旧值, 新建修订版本进入待执行。
 * 必须填写原因; 旧版本额度随修订链转移给新版本。
 */
export function reviseSchedule(
  state: AppState,
  scheduleId: string,
  input: { date: string; amountLiters: number; reason: string }
): OpResult {
  const target = state.schedules.find((s) => s.id === scheduleId);
  if (!target) return err("排程不存在");
  if (target.status !== "executed") return err("仅已执行排程需要修订; 未执行排程请直接调整");
  if (target.superseded) return err("该排程已有后续修订, 请修订修订链最新版本");
  const reason = input.reason.trim();
  if (!reason) return err("已执行排程冻结: 修订必须填写原因");
  const invalid = validatePlan(state, target.tankId, input.date, input.amountLiters);
  if (invalid) return err(invalid);
  const revision: Schedule = {
    id: nextId("SC", state.schedules.map((s) => s.id)),
    tankId: target.tankId,
    date: input.date,
    amountLiters: Math.round(input.amountLiters),
    status: "planned",
    superseded: false,
    revisionOf: target.id,
    revisionReason: reason,
    createdAt: now(),
  };
  const schedules = state.schedules.map((s) => (s.id === scheduleId ? { ...s, superseded: true } : s));
  return ok({ ...state, schedules: [...schedules, revision] });
}

/** 取消未执行排程, 释放其额度 */
export function cancelSchedule(state: AppState, scheduleId: string): OpResult {
  const target = state.schedules.find((s) => s.id === scheduleId);
  if (!target) return err("排程不存在");
  if (target.superseded) return err("该排程已被修订取代并冻结");
  if (target.status !== "planned") return err("已执行排程已冻结, 不能取消, 只能修订");
  return ok({ ...state, schedules: state.schedules.filter((s) => s.id !== scheduleId) });
}
