const MEMORY_ESTIMATION_NODE_LIMIT = 5_000;
const OBJECT_OVERHEAD_BYTES = 48;
const ARRAY_OVERHEAD_BYTES = 32;
const MAP_OVERHEAD_BYTES = 56;
const POINTER_BYTES = 8;

interface MemoryEstimationState {
  seen: WeakSet<object>;
  visitedNodes: number;
}

function estimatePrimitiveBytes(value: unknown): number {
  if (typeof value === "string") return value.length * 2;
  if (typeof value === "number") return 8;
  if (typeof value === "boolean") return 4;
  if (typeof value === "bigint") return 16;
  if (typeof value === "symbol") return String(value).length * 2;
  return 0;
}

function shouldVisitMemoryNode(state: MemoryEstimationState): boolean {
  if (state.visitedNodes >= MEMORY_ESTIMATION_NODE_LIMIT) return false;
  state.visitedNodes += 1;
  return true;
}

function estimateObjectBytesInternal(
  value: unknown,
  state: MemoryEstimationState
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "object") return estimatePrimitiveBytes(value);
  if (state.seen.has(value)) return 0;
  if (!shouldVisitMemoryNode(state)) return 0;

  state.seen.add(value);

  if (Array.isArray(value)) {
    let bytes = ARRAY_OVERHEAD_BYTES + value.length * POINTER_BYTES;
    for (const item of value) {
      bytes += estimateObjectBytesInternal(item, state);
      if (state.visitedNodes >= MEMORY_ESTIMATION_NODE_LIMIT) break;
    }
    return bytes;
  }

  if (value instanceof Map) {
    let bytes = MAP_OVERHEAD_BYTES + value.size * POINTER_BYTES * 2;
    for (const [entryKey, entryValue] of value) {
      bytes += estimateObjectBytesInternal(entryKey, state);
      bytes += estimateObjectBytesInternal(entryValue, state);
      if (state.visitedNodes >= MEMORY_ESTIMATION_NODE_LIMIT) break;
    }
    return bytes;
  }

  let bytes = OBJECT_OVERHEAD_BYTES;
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    bytes += key.length * 2 + POINTER_BYTES;
    bytes += estimateObjectBytesInternal(record[key], state);
    if (state.visitedNodes >= MEMORY_ESTIMATION_NODE_LIMIT) break;
  }
  return bytes;
}

export function estimateObjectBytes(value: unknown): number {
  return estimateObjectBytesInternal(value, {
    seen: new WeakSet<object>(),
    visitedNodes: 0,
  });
}
