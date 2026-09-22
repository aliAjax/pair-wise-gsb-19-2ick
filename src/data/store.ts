// 数据层: localStorage 持久化。只存实体 (鱼缸/检测/排程),
// 额度占用、冲突、资格等均为规则层派生值, 刷新后由实体重算, 保证一致。

import type { AppState } from "./types";
import { seedState } from "./seed";

const STORAGE_KEY = "hxwl05-water-scheduler-v1";

function isAppState(value: unknown): value is AppState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tanks) && Array.isArray(v.tests) && Array.isArray(v.schedules);
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed: unknown = JSON.parse(raw);
    return isAppState(parsed) ? parsed : seedState();
  } catch {
    return seedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用 (隐私模式/超限) 时静默降级为内存态
  }
}

export function resetState(): AppState {
  const state = seedState();
  saveState(state);
  return state;
}
