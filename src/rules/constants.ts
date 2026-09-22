// 规则层: 全部业务规则常量集中在这里, 页面不硬编码规则数值。

import type { Priority } from "../data/types";

/** 每日共享换水上限 (L): 同一日期所有排程实占之和不得超过该值 */
export const DAILY_CAP_LITERS = 120;

/** 单次换水量不得超过鱼缸登记水量的比例 */
export const MAX_CHANGE_RATIO = 0.5;

/** 优先级占用权重: 同日共享额度时高优先级先占用 */
export const PRIORITY_WEIGHT: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

export const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

export const TANK_KINDS = ["草缸", "海缸", "三湖缸", "繁殖缸"];

/** 检测结论判定阈值 */
export const TEST_THRESHOLDS = {
  phMin: 6.2,
  phMax: 8.4,
  ammoniaWatch: 0.1, // 氨氮 mg/L, 超过记"关注"
  ammoniaMax: 0.25, // 超过记"异常"
  nitriteWatch: 0.05, // 亚硝酸盐 mg/L
  nitriteMax: 0.1,
  nitrateWatch: 40, // 硝酸盐 ppm
  nitrateMax: 80,
};

export type RuleId = "R1" | "R2" | "R3";

export const RULE_TEXT: Record<RuleId, string> = {
  R1: "R1 检测资格: 异常未复测合格, 禁止排换水",
  R2: "R2 共享额度: 同日换水共享上限, 高优先级先占用, 不得超额",
  R3: "R3 单缸限量: 单次换水量不得超过登记水量的 50%",
};
