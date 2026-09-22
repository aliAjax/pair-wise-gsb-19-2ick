// 换水排程台 —— 领域类型（数据层）

/** 维护优先级：高优先级在同日额度中先占用 */
export type Priority = "high" | "normal" | "low";

/** 检测结论：合格 / 关注 / 异常（异常未复测合格禁排） */
export type Verdict = "ok" | "watch" | "abnormal";

export type ScheduleStatus = "pending" | "executed";

export type ConflictType =
  | "tank-ineligible" // R1：鱼缸当前不具备换水准入
  | "quota" // R2/R3：日期共享额度不足
  | "over-capacity" // R5：换水量超过鱼缸登记水量
  | "frozen"; // R4：已执行冻结 / 修订链问题

export interface Tank {
  id: string;
  name: string;
  kind: string; // 草缸 / 海缸 / 三湖缸 / 繁殖缸
  volumeLiters: number; // 登记水量（升）
  priority: Priority; // 维护优先级
  createdAt: number;
}

export interface WaterTest {
  id: string;
  tankId: string;
  date: string; // YYYY-MM-DD
  ph: number | null;
  ammonia: number | null; // 氨氮 mg/L
  nitrite: number | null; // 亚硝酸盐 mg/L
  nitrate: number | null; // 硝酸盐 mg/L
  verdict: Verdict;
  note?: string;
  createdAt: number;
}

export interface Schedule {
  id: string;
  tankId: string;
  date: string; // 计划换水日期
  amountLiters: number;
  status: ScheduleStatus;
  createdAt: number;
  executedAt?: number;
  /** 修订链：本条修订自哪一条（通常是已执行冻结项） */
  revisionOfId?: string;
  /** 修订链根 id，刷新后仍可串联整条链 */
  chainRootId?: string;
  /** 新建修订时必填的原因 */
  revisionReason?: string;
  note?: string;
}

/** 某日期的专属额度上限（缺省回落 defaultCap） */
export interface CapOverride {
  date: string;
  capLiters: number;
}

export interface RootState {
  version: 1;
  tanks: Tank[];
  tests: WaterTest[];
  schedules: Schedule[];
  caps: CapOverride[];
  defaultCap: number;
  updatedAt: number;
}

export interface AllocationConflict {
  /** 去重键 */
  key: string;
  type: ConflictType;
  tankId?: string;
  tankName?: string;
  date?: string;
  /** 额度/容量缺口（升，恒为正） */
  gapLiters?: number;
  /** 触发规则编号，如 R2 */
  rule: string;
  title: string;
  detail: string;
}

export interface EligibilityResult {
  eligible: boolean;
  verdict?: Verdict;
  latestTestDate?: string;
  reason?: string;
}

export interface AllocationRow {
  scheduleId: string;
  tankId: string;
  amountLiters: number;
  priority: Priority;
  status: ScheduleStatus;
  fits: boolean;
  /** 轮到该项时距离占满的缺口（fits=false 时为正） */
  gapLiters: number;
}

export interface DayAllocation {
  date: string;
  capLiters: number;
  executedLiters: number;
  pendingFittedLiters: number;
  usedLiters: number;
  freeLiters: number;
  rows: AllocationRow[];
}

/** 排程新增 / 编辑 / 修订的输入草稿 */
export interface ScheduleDraft {
  tankId: string;
  date: string;
  amountLiters: number;
  revisionReason?: string;
  note?: string;
}

export interface PlanResult {
  ok: boolean;
  conflicts: AllocationConflict[];
}
