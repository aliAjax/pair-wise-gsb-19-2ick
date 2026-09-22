// 规则层: 检测结论判定与换水资格 (R1)。

import type { AppState, TestResult, WaterTest } from "../data/types";
import { idSeq } from "../data/ids";
import { TEST_THRESHOLDS } from "./constants";

export interface TestInput {
  ph: number;
  ammonia: number;
  nitrite: number;
  nitrate: number;
}

/** 按阈值判定检测结论 */
export function judgeTest(input: TestInput): TestResult {
  const t = TEST_THRESHOLDS;
  if (
    input.ph < t.phMin ||
    input.ph > t.phMax ||
    input.ammonia > t.ammoniaMax ||
    input.nitrite > t.nitriteMax ||
    input.nitrate > t.nitrateMax
  ) {
    return "abnormal";
  }
  if (input.ammonia > t.ammoniaWatch || input.nitrite > t.nitriteWatch || input.nitrate > t.nitrateWatch) {
    return "watch";
  }
  return "pass";
}

/** 检测排序: 先按日期, 同日按录入顺序 */
export function compareTests(a: WaterTest, b: WaterTest): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return idSeq(a.id) - idSeq(b.id);
}

export function testsOf(state: AppState, tankId: string): WaterTest[] {
  return state.tests.filter((t) => t.tankId === tankId).sort(compareTests);
}

export function latestTestOf(state: AppState, tankId: string): WaterTest | undefined {
  const list = testsOf(state, tankId);
  return list[list.length - 1];
}

export interface Eligibility {
  ok: boolean;
  reason: string | null;
  blockingTest: WaterTest | null;
}

/**
 * R1: 存在异常检测时, 必须有时间更晚的"合格"复测才恢复换水资格;
 * 否则禁止排换水。
 */
export function checkEligibility(state: AppState, tankId: string): Eligibility {
  const list = testsOf(state, tankId);
  const abnormals = list.filter((t) => t.result === "abnormal");
  if (abnormals.length === 0) {
    return { ok: true, reason: null, blockingTest: null };
  }
  const lastAbnormal = abnormals[abnormals.length - 1];
  const retestedPass = list.some((t) => t.result === "pass" && compareTests(t, lastAbnormal) > 0);
  if (retestedPass) {
    return { ok: true, reason: null, blockingTest: null };
  }
  return {
    ok: false,
    reason: `最近异常(${lastAbnormal.date})未复测合格`,
    blockingTest: lastAbnormal,
  };
}
