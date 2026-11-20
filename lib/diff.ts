// Word-level diff for showing suggestions as tracked changes (red strike = removed, green = added).
export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

export function wordDiff(a: string, b: string): DiffPart[] {
  const A = tokens(a);
  const B = tokens(b);
  const n = A.length;
  const m = B.length;
  // LCS table (posts are short, so O(n*m) is fine)
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("same", A[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("ins", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return coalesce(out);
}

// Merge a run of changes separated only by spaces into one removed phrase + one added phrase,
// so "~~Prompts~~ Your ~~are~~ agent" reads as "~~Prompts are~~ Your agent".
function coalesce(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i].kind === "same") {
      out.push(parts[i++]);
      continue;
    }
    let del = "";
    let ins = "";
    let j = i;
    while (j < parts.length) {
      const p = parts[j];
      if (p.kind === "del") del += p.text;
      else if (p.kind === "ins") ins += p.text;
      else if (/^\s+$/.test(p.text) && j + 1 < parts.length && parts[j + 1].kind !== "same") {
        del += p.text;
        ins += p.text;
      } else break;
      j++;
    }
    if (del) out.push({ kind: "del", text: del });
    if (ins) out.push({ kind: "ins", text: ins });
    i = j;
  }
  return out;
}
