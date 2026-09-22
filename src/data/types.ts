// 数据层: 领域模型定义。不依赖规则层与页面层。

/** 维护优先级 */
export type Priority = "high" | "medium" | "low";

/** 检测结论: 合格 / 关注 / 异常 */
export type TestResult = "pass" | "watch" | "abnormal";

export type ScheduleStatus = "planned" | "executed";

/** 鱼缸登记: 水量与维护优先级 */
export interface Tank {
  id: string;
  name: string;
  kind: string;
  volumeLiters: number;
  priority: Priority;
}

/** 水质检测记录: result 由规则层判定后随记录落库, 保证刷新后一致 */
export interface WaterTest {
  id: string;
  tankId: string;
  date: string; // YYYY-MM-DD
  ph: number;
  ammonia: number; // 氨氮 mg/L
  nitrite: number; // 亚硝酸盐 mg/L
  nitrate: number; // 硝酸盐 ppm
  result: TestResult;
}

/**
 * 换水排程。
 * 已执行即冻结: 不能直接改, 只能带原因新建修订版本;
 * 被修订取代的旧版本 superseded=true, 旧值保留但不再占用额度。
 */
export interface Schedule {
  id: string;
  tankId: string;
  date: string; // YYYY-MM-DD
  amountLiters: number;
  status: ScheduleStatus;
  superseded: boolean;
  revisionOf: string | null;
  revisionReason: string | null;
  createdAt: string; // ISO 时间, 同优先级时先创建先占用
}

export interface AppState {
  tanks: Tank[];
  tests: WaterTest[];
  schedules: Schedule[];
}
