// 数据层: 顺序 id 生成 (TK-001 / WT-001 / SC-001)

export function nextId(prefix: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function idSeq(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}
