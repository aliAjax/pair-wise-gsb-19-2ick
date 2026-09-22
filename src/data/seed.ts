// 数据层: 演示种子数据。检测结论与规则层阈值保持一致。

import type { AppState } from "./types";

export function seedState(): AppState {
  return {
    tanks: [
      { id: "TK-001", name: "草缸A", kind: "草缸", volumeLiters: 200, priority: "medium" },
      { id: "TK-002", name: "海缸B", kind: "海缸", volumeLiters: 350, priority: "high" },
      { id: "TK-003", name: "三湖缸C", kind: "三湖缸", volumeLiters: 280, priority: "low" },
      { id: "TK-004", name: "繁殖缸D", kind: "繁殖缸", volumeLiters: 90, priority: "high" },
    ],
    tests: [
      { id: "WT-001", tankId: "TK-001", date: "2026-09-20", ph: 6.8, ammonia: 0.05, nitrite: 0.02, nitrate: 18, result: "pass" },
      { id: "WT-002", tankId: "TK-002", date: "2026-09-18", ph: 8.1, ammonia: 0.4, nitrite: 0.2, nitrate: 25, result: "abnormal" },
      // 海缸B 异常后复测合格, 恢复换水资格
      { id: "WT-003", tankId: "TK-002", date: "2026-09-21", ph: 8.2, ammonia: 0.05, nitrite: 0.02, nitrate: 20, result: "pass" },
      { id: "WT-004", tankId: "TK-003", date: "2026-09-19", ph: 7.8, ammonia: 0.12, nitrite: 0.06, nitrate: 55, result: "watch" },
      // 繁殖缸D 异常且未复测, 触发 R1
      { id: "WT-005", tankId: "TK-004", date: "2026-09-21", ph: 7.2, ammonia: 0.5, nitrite: 0.3, nitrate: 30, result: "abnormal" },
    ],
    schedules: [
      // 09-24 共享 120L: 海缸B 高优先级先占 100L, 草缸A 申请 60L 只占到 20L, 缺口 40L (R2)
      { id: "SC-001", tankId: "TK-002", date: "2026-09-24", amountLiters: 100, status: "planned", superseded: false, revisionOf: null, revisionReason: null, createdAt: "2026-09-21T09:00:00.000Z" },
      { id: "SC-002", tankId: "TK-001", date: "2026-09-24", amountLiters: 60, status: "planned", superseded: false, revisionOf: null, revisionReason: null, createdAt: "2026-09-21T09:30:00.000Z" },
      // 繁殖缸D 异常未复测, 该排程触发 R1
      { id: "SC-003", tankId: "TK-004", date: "2026-09-25", amountLiters: 30, status: "planned", superseded: false, revisionOf: null, revisionReason: null, createdAt: "2026-09-21T10:00:00.000Z" },
      { id: "SC-004", tankId: "TK-003", date: "2026-09-23", amountLiters: 80, status: "executed", superseded: false, revisionOf: null, revisionReason: null, createdAt: "2026-09-20T08:00:00.000Z" },
      // 修订链: SC-005 已执行后被 SC-006 修订, 旧值冻结保留
      { id: "SC-005", tankId: "TK-001", date: "2026-09-21", amountLiters: 50, status: "executed", superseded: true, revisionOf: null, revisionReason: null, createdAt: "2026-09-19T08:00:00.000Z" },
      { id: "SC-006", tankId: "TK-001", date: "2026-09-23", amountLiters: 40, status: "planned", superseded: false, revisionOf: "SC-005", revisionReason: "种鱼产卵, 推迟两天并减量至 40L", createdAt: "2026-09-21T11:00:00.000Z" },
    ],
  };
}
