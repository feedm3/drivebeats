export interface ShuffleCycle {
  remainingIds: string[];
  playedIds: string[];
}

function shuffled(ids: string[]) {
  const result = [...new Set(ids)];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createShuffleCycle(ids: string[], currentId?: string) {
  return {
    remainingIds: shuffled(ids.filter((id) => id !== currentId)),
    playedIds: currentId && ids.includes(currentId) ? [currentId] : [],
  };
}

export function reconcileShuffleCycle(
  cycle: ShuffleCycle | null,
  ids: string[],
  currentId?: string,
): ShuffleCycle {
  if (!cycle) return createShuffleCycle(ids, currentId);
  const valid = new Set(ids);
  const playedIds = [...new Set(cycle.playedIds)].filter((id) => valid.has(id));
  const played = new Set(playedIds);
  const remainingIds = [...new Set(cycle.remainingIds)].filter(
    (id) => valid.has(id) && !played.has(id),
  );
  const known = new Set([...playedIds, ...remainingIds]);
  const added = shuffled(ids.filter((id) => !known.has(id)));
  return { remainingIds: [...remainingIds, ...added], playedIds };
}

export function consumeShuffleTrack(cycle: ShuffleCycle, id: string) {
  return {
    remainingIds: cycle.remainingIds.filter((remaining) => remaining !== id),
    playedIds: cycle.playedIds.includes(id)
      ? cycle.playedIds
      : [...cycle.playedIds, id],
  };
}

export function restartShuffleCycle(
  ids: string[],
  currentId?: string,
  reservedId?: string | null,
): ShuffleCycle {
  const cycle = createShuffleCycle(ids);
  const firstId =
    reservedId && ids.includes(reservedId) && reservedId !== currentId
      ? reservedId
      : cycle.remainingIds.find((id) => id !== currentId);
  if (firstId) {
    cycle.remainingIds = [
      firstId,
      ...cycle.remainingIds.filter((id) => id !== firstId),
    ];
  }
  return cycle;
}
