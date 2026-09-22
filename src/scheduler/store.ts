// 换水排程台 —— 状态存储（数据层）：localStorage 持久化，规则全部委托 rules.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allocationByDate,
  chainIntegrity,
  dedupeConflicts,
  liveConflicts,
  planCapChange,
  planScheduleChange,
} from "./rules";
import { buildSeedState } from "./seed";
import type {
  AllocationConflict,
  CapOverride,
  Priority,
  RootState,
  Schedule,
  ScheduleDraft,
  WaterTest,
} from "./types";

const STORAGE_KEY = "hxwl-05-water-change-station-v1";

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}${Math.floor(Math.random() * 1e4)}`;
}

function isValidState(value: unknown): value is RootState {
  if (!value || typeof value !== "object") return false;
  const v = value as RootState;
  return (
    v.version === 1 &&
    Array.isArray(v.tanks) &&
    Array.isArray(v.tests) &&
    Array.isArray(v.schedules) &&
    Array.isArray(v.caps) &&
    typeof v.defaultCap === "number"
  );
}

function loadState(): RootState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidState(parsed)) return parsed;
    }
  } catch {
    // 损坏数据回落种子，不阻断页面
  }
  return buildSeedState();
}

export interface TankDraft {
  name: string;
  kind: string;
  volumeLiters: number;
  priority: Priority;
}

export interface TestDraft {
  tankId: string;
  date: string;
  ph: number | null;
  ammonia: number | null;
  nitrite: number | null;
  nitrate: number | null;
  verdict: WaterTest["verdict"];
  note?: string;
}

export function useScheduler() {
  const [state, setState] = useState<RootState>(loadState);
  const [report, setReport] = useState<AllocationConflict[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时页面仍可内存运行
    }
  }, [state]);

  const commit = useCallback((produce: (prev: RootState) => RootState) => {
    setState((prev) => ({ ...produce(prev), updatedAt: Date.now() }));
    setReport([]);
  }, []);

  const fail = useCallback((conflicts: AllocationConflict[]) => {
    setReport(conflicts);
  }, []);

  // ---- 鱼缸登记 ----
  const addTank = useCallback(
    (draft: TankDraft) => {
      commit((prev) => ({
        ...prev,
        tanks: [
          ...prev.tanks,
          {
            id: nextId("tank"),
            name: draft.name.trim(),
            kind: draft.kind,
            volumeLiters: draft.volumeLiters,
            priority: draft.priority,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [commit]
  );

  const updateTank = useCallback(
    (tankId: string, patch: Partial<Pick<TankDraft, "name" | "kind" | "volumeLiters" | "priority">>) => {
      commit((prev) => ({
        ...prev,
        tanks: prev.tanks.map((t) =>
          t.id === tankId
            ? {
                ...t,
                ...("name" in patch && patch.name !== undefined ? { name: patch.name.trim() } : {}),
                ...("kind" in patch && patch.kind !== undefined ? { kind: patch.kind } : {}),
                ...("volumeLiters" in patch && patch.volumeLiters !== undefined
                  ? { volumeLiters: patch.volumeLiters }
                  : {}),
                ...("priority" in patch && patch.priority !== undefined ? { priority: patch.priority } : {}),
              }
            : t
        ),
      }));
    },
    [commit]
  );

  /** 仍有检测或排程引用的鱼缸不可删除（防止刷新后出现悬挂引用） */
  const tankRemovable = useCallback(
    (tankId: string): boolean =>
      !state.tests.some((t) => t.tankId === tankId) &&
      !state.schedules.some((s) => s.tankId === tankId),
    [state]
  );

  const removeTank = useCallback(
    (tankId: string): boolean => {
      if (!stateRef.current.tests.every((t) => t.tankId !== tankId)) return false;
      if (!stateRef.current.schedules.every((s) => s.tankId !== tankId)) return false;
      commit((prev) => ({ ...prev, tanks: prev.tanks.filter((t) => t.id !== tankId) }));
      return true;
    },
    [commit]
  );

  // ---- 检测 ----
  const addTest = useCallback(
    (draft: TestDraft) => {
      commit((prev) => ({
        ...prev,
        tests: [
          ...prev.tests,
          {
            id: nextId("test"),
            tankId: draft.tankId,
            date: draft.date,
            ph: draft.ph,
            ammonia: draft.ammonia,
            nitrite: draft.nitrite,
            nitrate: draft.nitrate,
            verdict: draft.verdict,
            note: draft.note?.trim() || undefined,
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [commit]
  );

  const removeTest = useCallback(
    (testId: string) => {
      commit((prev) => ({ ...prev, tests: prev.tests.filter((t) => t.id !== testId) }));
    },
    [commit]
  );

  // ---- 排程 ----
  /**
   * 保存排程：editingId 为未执行项 id 时是调整（R3：先释放原额度再重算）；
   * revisionOf 给定时是对已执行冻结项新建修订（R4：必须有原因，旧排程保留）。
   */
  const saveSchedule = useCallback(
    (draft: ScheduleDraft, editingId?: string, revisionOf?: Schedule): boolean => {
      const current = stateRef.current;
      const plan = planScheduleChange(current, draft, editingId, revisionOf);
      if (!plan.ok) {
        fail(plan.conflicts);
        return false;
      }
      commit((prev) => {
        if (editingId) {
          return {
            ...prev,
            schedules: prev.schedules.map((s) =>
              s.id === editingId
                ? {
                    ...s,
                    tankId: draft.tankId,
                    date: draft.date,
                    amountLiters: draft.amountLiters,
                    note: draft.note?.trim() || s.note,
                  }
                : s
            ),
          };
        }
        const base: Schedule = {
          id: nextId("sch"),
          tankId: draft.tankId,
          date: draft.date,
          amountLiters: draft.amountLiters,
          status: "pending",
          createdAt: Date.now(),
          note: draft.note?.trim() || undefined,
        };
        if (revisionOf) {
          base.revisionOfId = revisionOf.id;
          base.chainRootId = revisionOf.chainRootId ?? revisionOf.id;
          base.revisionReason = draft.revisionReason?.trim();
        }
        return { ...prev, schedules: [...prev.schedules, base] };
      });
      return true;
    },
    [commit, fail]
  );

  const executeSchedule = useCallback(
    (scheduleId: string) => {
      commit((prev) => ({
        ...prev,
        schedules: prev.schedules.map((s) =>
          s.id === scheduleId && s.status === "pending"
            ? { ...s, status: "executed", executedAt: Date.now() }
            : s
        ),
      }));
    },
    [commit]
  );

  /** 未执行项可删除；已执行项冻结，只能修订不能删 */
  const removeSchedule = useCallback(
    (scheduleId: string): boolean => {
      const target = stateRef.current.schedules.find((s) => s.id === scheduleId);
      if (!target || target.status === "executed") {
        if (target) {
          fail([
            {
              key: `frozen:${target.id}`,
              type: "frozen",
              tankId: target.tankId,
              date: target.date,
              rule: "R4",
              title: "已执行排程已冻结",
              detail: "已执行记录不可删除，如需更正请带原因新建修订",
            },
          ]);
        }
        return false;
      }
      commit((prev) => ({ ...prev, schedules: prev.schedules.filter((s) => s.id !== scheduleId) }));
      return true;
    },
    [commit, fail]
  );

  // ---- 额度 ----
  const setCap = useCallback(
    (date: string | null, capLiters: number): boolean => {
      const current = stateRef.current;
      const plan = planCapChange(current, date, capLiters);
      if (!plan.ok) {
        fail(plan.conflicts);
        return false;
      }
      commit((prev) => {
        if (!date) return { ...prev, defaultCap: capLiters };
        const next: CapOverride = { date, capLiters };
        return {
          ...prev,
          caps: [...prev.caps.filter((c) => c.date !== date), next],
        };
      });
      return true;
    },
    [commit, fail]
  );

  const resetToSeed = useCallback(() => {
    setState(buildSeedState());
    setReport([]);
  }, []);

  const dismissReport = useCallback(() => setReport([]), []);

  // ---- 刷新一致性：所有占用 / 冲突都由数据实时推导，不单独存储 ----
  const allocations = useMemo(() => allocationByDate(state), [state]);
  const currentConflicts = useMemo(
    () => dedupeConflicts([...liveConflicts(state), ...chainIntegrity(state)]),
    [state]
  );
  const reportConflicts = useMemo(
    () => report.filter((c) => !currentConflicts.some((live) => live.key === c.key)),
    [report, currentConflicts]
  );

  return {
    state,
    allocations,
    currentConflicts,
    reportConflicts,
    addTank,
    updateTank,
    tankRemovable,
    removeTank,
    addTest,
    removeTest,
    saveSchedule,
    executeSchedule,
    removeSchedule,
    setCap,
    resetToSeed,
    dismissReport,
  };
}
