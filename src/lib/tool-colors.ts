import { useEffect, useState } from "react";
import { TOOLS, type ToolId } from "./smc";

export type ToolColorMap = Record<ToolId, string>;

const STORAGE_KEY = "mfsmc.toolColors.v1";

export const DEFAULT_TOOL_COLORS: ToolColorMap = TOOLS.reduce((acc, t) => {
  acc[t.id] = t.color;
  return acc;
}, {} as ToolColorMap);

/** 12 preset swatches offered in the tool colour picker. */
export const COLOR_PRESETS = [
  "#111827",
  "#64748b",
  "#38bdf8",
  "#2563eb",
  "#a78bfa",
  "#ec4899",
  "#ef4444",
  "#fb923c",
  "#f59e0b",
  "#facc15",
  "#34d399",
  "#14b8a6",
];

let current: ToolColorMap = { ...DEFAULT_TOOL_COLORS };
let hydrated = false;
const listeners = new Set<(map: ToolColorMap) => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<ToolColorMap>;
    const next = { ...DEFAULT_TOOL_COLORS };
    for (const tool of TOOLS) {
      const value = parsed[tool.id];
      if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) next[tool.id] = value;
    }
    current = next;
  } catch {
    // Corrupt storage falls back to defaults.
  }
}

export function getToolColors(): ToolColorMap {
  hydrate();
  return current;
}

export function getToolColor(id: ToolId): string {
  return getToolColors()[id] ?? DEFAULT_TOOL_COLORS[id] ?? "#38bdf8";
}

export function setToolColor(id: ToolId, color: string) {
  hydrate();
  current = { ...current, [id]: color };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Persistence is best-effort.
  }
  listeners.forEach((fn) => fn(current));
}

export function resetToolColor(id: ToolId) {
  setToolColor(id, DEFAULT_TOOL_COLORS[id]);
}

/** Subscribe to colour changes; returns an unsubscribe fn. */
export function subscribeToolColors(fn: (map: ToolColorMap) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React binding — re-renders on any tool colour change and after hydration. */
export function useToolColors(): ToolColorMap {
  const [map, setMap] = useState<ToolColorMap>(() => ({ ...DEFAULT_TOOL_COLORS }));
  useEffect(() => {
    setMap(getToolColors());
    return subscribeToolColors((next) => setMap(next));
  }, []);
  return map;
}

// ── colour maths for the shade slider ────────────────────────────────────────

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) / 60 % 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Same hue/saturation, new lightness (0-100) — powers the shade slider. */
export function withLightness(hex: string, lightness: number) {
  const { h, s } = rgbToHsl(hex);
  return hslToHex(h, s, lightness);
}
