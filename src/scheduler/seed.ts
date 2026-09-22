// 换水排程台 —— 初始数据（数据层）
import type { RootState } from "./types";
import { todayISO } from "./rules";

function shiftISO(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 种子场景：
 * - 草缸A：检测合格，高优先级；已有一条昨天已执行（冻结）排程，带一条今天的修订。
 * - 海缸B：最近一次检测异常且未复测，今天的未执行换水单被 R1 拦截。
 * - 繁殖缸C：异常后已复测合格，可正常排换水。
 * - 三湖缸D：仅一次关注级检测；明天 150L 大单在 300L 共享额度中与草缸A冲突（R2 演示）。
 */
export function buildSeedState(): RootState {
  const now = Date.now();
  const today = todayISO();
  const yesterday = shiftISO(-1);
  const tomorrow = shiftISO(1);
  const d2ago = shiftISO(-2);
  const d3ago = shiftISO(-3);
  const d4ago = shiftISO(-4);
  const d5ago = shiftISO(-5);
  const d6ago = shiftISO(-6);

  return {
    version: 1,
    defaultCap: 300,
    caps: [],
    tanks: [
      { id: "tank-a", name: "草缸A", kind: "草缸", volumeLiters: 200, priority: "high", createdAt: now - 9000 },
      { id: "tank-b", name: "海缸B", kind: "海缸", volumeLiters: 260, priority: "normal", createdAt: now - 8000 },
      { id: "tank-c", name: "繁殖缸C", kind: "繁殖缸", volumeLiters: 120, priority: "normal", createdAt: now - 7000 },
      { id: "tank-d", name: "三湖缸D", kind: "三湖缸", volumeLiters: 300, priority: "low", createdAt: now - 6000 },
    ],
    tests: [
      {
        id: "test-a1",
        tankId: "tank-a",
        date: d3ago,
        ph: 6.8,
        ammonia: 0.01,
        nitrite: 0.02,
        nitrate: 18,
        verdict: "ok",
        note: "水质稳定，可按计划换水",
        createdAt: now - 5000,
      },
      {
        id: "test-b1",
        tankId: "tank-b",
        date: d5ago,
        ph: 8.1,
        ammonia: 0.01,
        nitrite: 0.06,
        nitrate: 25,
        verdict: "watch",
        note: "钙硬度偏低，需要持续观察",
        createdAt: now - 4800,
      },
      {
        id: "test-b2",
        tankId: "tank-b",
        date: d2ago,
        ph: 7.9,
        ammonia: 0.05,
        nitrite: 0.25,
        nitrate: 30,
        verdict: "abnormal",
        note: "氨氮与亚硝酸盐升高，停止投喂，复测合格前禁排换水",
        createdAt: now - 4700,
      },
      {
        id: "test-c1",
        tankId: "tank-c",
        date: d6ago,
        ph: 7.2,
        ammonia: 0.08,
        nitrite: 0.3,
        nitrate: 45,
        verdict: "abnormal",
        note: "亚硝酸盐升高",
        createdAt: now - 4600,
      },
      {
        id: "test-c2",
        tankId: "tank-c",
        date: d3ago,
        ph: 7.1,
        ammonia: 0.01,
        nitrite: 0.04,
        nitrate: 22,
        verdict: "ok",
        note: "复测合格，恢复换水安排",
        createdAt: now - 4500,
      },
      {
        id: "test-d1",
        tankId: "tank-d",
        date: d4ago,
        ph: 8.2,
        ammonia: 0.01,
        nitrite: 0.05,
        nitrate: 32,
        verdict: "watch",
        note: "硝酸盐接近上限，关注但可换水",
        createdAt: now - 4400,
      },
    ],
    schedules: [
      {
        id: "sch-exec-1",
        tankId: "tank-a",
        date: yesterday,
        amountLiters: 60,
        status: "executed",
        createdAt: now - 4000,
        executedAt: now - 2000,
        note: "周末常规换水 30%",
      },
      {
        id: "sch-rev-1",
        tankId: "tank-a",
        date: today,
        amountLiters: 80,
        status: "pending",
        createdAt: now - 3000,
        revisionOfId: "sch-exec-1",
        chainRootId: "sch-exec-1",
        revisionReason: "昨日实际只换了 40L，补一次换水并加大流量冲减硝酸盐",
        note: "由已执行单修订而来，旧值 60L 保留",
      },
      {
        id: "sch-blocked-1",
        tankId: "tank-b",
        date: today,
        amountLiters: 90,
        status: "pending",
        createdAt: now - 2500,
        note: "异常未复测，本单应被 R1 拦截",
      },
      {
        id: "sch-tom-a",
        tankId: "tank-a",
        date: tomorrow,
        amountLiters: 180,
        status: "pending",
        createdAt: now - 2000,
      },
      {
        id: "sch-tom-d",
        tankId: "tank-d",
        date: tomorrow,
        amountLiters: 150,
        status: "pending",
        createdAt: now - 1000,
        note: "低优先级：300L 共享额度被草缸A先占 180L，剩余 120L 放不下",
      },
    ],
    updatedAt: now,
  };
}
