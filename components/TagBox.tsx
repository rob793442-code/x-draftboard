"use client";
// Comment boxes: type @ to tag a teammate. Tagged people get a Slack DM when the comment is posted (lib/notify.ts).
// The list comes from /api/people: only people in SLACK_USERS can be tagged, so it's empty when Slack isn't set up.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MENTION_RE, splitMentions, type Person } from "@/lib/mention";

// ---------- one shared copy of the people list ----------
const EMPTY: Person[] = [];
let people: Person[] = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function load() {
  loading ??= fetch("/api/people")
    .then((r) => (r.ok ? r.json() : { people: [] }))
    .then((j: { people?: Person[] }) => {
      people = j.people?.length ? j.people : EMPTY;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

/** Teammates who can be tagged. Empty when Slack notifications aren't set up. */
export function usePeople(enabled = true): Person[] {
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return useSyncExternalStore(subscribe, () => people, () => EMPTY);
}

const tagFor = (p: Person) => (p.tags.includes(p.name.toLowerCase()) ? p.name : p.tags[0]);

/** A comment body with @tags of known people in blue. */
export function TagText({ body, people }: { body: string; people: Person[] }) {
  return (
    <>
      {splitMentions(body, people).map((s, i) =>
        s.person ? (
          <span key={i} className="font-medium text-accent" title={`${s.person.name} · ${s.person.email}`}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Names of the people (other than `me`) a draft comment tags. */
export function taggedIn(body: string, people: Person[], me: string): Person[] {
  const out: Person[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const p = people.find((x) => x.tags.includes(m[2].toLowerCase()));
    if (p && p.email !== me && !out.includes(p)) out.push(p);
  }
  return out;
}

export function TagBox({
  value,
  onChange,
  onSubmit,
  me,
  className,
  placeholder,
  rows,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  me: { email: string };
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const all = usePeople();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState<{ start: number; end: number; q: string } | null>(null);
  const [hi, setHi] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null); // Esc hides the menu for this @ only

  const choices = at
    ? all.filter((p) => p.email !== me.email && (p.name.toLowerCase().startsWith(at.q.toLowerCase()) || p.tags.some((t) => t.startsWith(at.q.toLowerCase()))))
    : [];
  const open = !!at && choices.length > 0 && closedAt !== at.start;
  const tagged = taggedIn(value, all, me.email);

  const sync = () => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setAt(null);
    const caret = el.selectionStart;
    const m = el.value.slice(0, caret).match(/(^|[^\w@/.])@([a-z0-9_]*)$/i);
    if (!m) return setAt(null);
    const start = caret - m[2].length - 1;
    setAt((prev) => (prev && prev.start === start && prev.q === m[2] ? prev : { start, end: caret, q: m[2] }));
  };
  useEffect(() => setHi(0), [at?.q, at?.start]);

  const pick = (p: Person) => {
    if (!at) return;
    const el = ref.current;
    const rest = value.slice(at.end);
    const ins = `@${tagFor(p)}${/^\s/.test(rest) ? "" : " "}`;
    const next = value.slice(0, at.start) + ins + rest;
    onChange(next);
    setAt(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = at.start + ins.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(sync);
        }}
        onSelect={sync}
        onBlur={() => setTimeout(() => setAt(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => (h + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(choices[Math.min(hi, choices.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setClosedAt(at!.start);
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/15 bg-[#0f1419] py-1 shadow-xl shadow-black/60">
          {choices.map((p, i) => (
            <button
              key={p.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${i === hi ? "bg-white/[0.08]" : ""}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/70 text-[11px] font-semibold text-on-primary">{p.name[0]?.toUpperCase()}</span>
              <span className="font-medium text-white">{p.name}</span>
              <span className="truncate text-white/40">{p.email}</span>
              <span className="ml-auto shrink-0 text-[10px] text-white/30">Slack ping</span>
            </button>
          ))}
        </div>
      )}
      {tagged.length > 0 && (
        <div className="mt-1 text-[11px] text-accent/80">
          {tagged.map((p) => p.name).join(" and ")} {tagged.length > 1 ? "get" : "gets"} a Slack ping when you post this.
        </div>
      )}
    </div>
  );
}
