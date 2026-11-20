// Folder order, shared by the server (moveDraft) and the board (drag and drop).
// Drafts an admin hasn't placed yet sit on top, newest first, so they get noticed; below them come the placed ones,
// in the order they were dragged into (`order` = the drafts.position column).
type Sortable = { order?: number | null; title: string; created_at?: string };

const placed = (d: { order?: number | null }) => typeof d.order === "number" && Number.isFinite(d.order);

export function compareBoard(a: Sortable, b: Sortable): number {
  const pa = placed(a);
  const pb = placed(b);
  if (pa !== pb) return pa ? 1 : -1;
  if (pa && pb && a.order !== b.order) return a.order! - b.order!;
  return (b.created_at ?? "").localeCompare(a.created_at ?? "") || a.title.localeCompare(b.title);
}

const STEP = 1024;

/**
 * New `order` values after a drag. `list` is one folder's drafts, top to bottom, with the moved draft already in its
 * new place. When the others are already placed in order, only the moved draft gets a new value (halfway between its
 * neighbours); otherwise the whole list is numbered once. Returns only the values that change.
 */
export function planOrder(list: { id: string; order?: number | null }[], movedId: string): Record<string, number> {
  const i = list.findIndex((x) => x.id === movedId);
  if (i < 0) return {};
  const others = list.filter((x) => x.id !== movedId);
  const settled = others.every((x, k) => placed(x) && (k === 0 || x.order! > others[k - 1].order!));
  if (settled) {
    const prev = list[i - 1]?.order ?? null;
    const next = list[i + 1]?.order ?? null;
    const v = prev === null && next === null ? STEP : prev === null ? next! - STEP : next === null ? prev + STEP : (prev + next) / 2;
    const fits = (prev === null || v > prev) && (next === null || v < next) && (prev === null || next === null || next - prev > 1e-6);
    if (fits) return list[i].order === v ? {} : { [movedId]: v };
  }
  const out: Record<string, number> = {};
  list.forEach((x, k) => {
    const v = (k + 1) * STEP;
    if (x.order !== v) out[x.id] = v;
  });
  return out;
}
