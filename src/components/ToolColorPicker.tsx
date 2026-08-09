import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolId } from "@/lib/smc";
import {
  COLOR_PRESETS,
  DEFAULT_TOOL_COLORS,
  resetToolColor,
  rgbToHsl,
  setToolColor,
  withLightness,
} from "@/lib/tool-colors";

interface Props {
  toolId: ToolId;
  toolName: string;
  color: string;
  onClose: () => void;
}

/**
 * Compact per-tool colour picker: 12 presets plus a dark→light shade slider.
 * Every change is applied immediately and persisted by the tool-colour store.
 */
export function ToolColorPicker({ toolId, toolName, color, onClose }: Props) {
  const [lightness, setLightness] = useState(() => Math.round(rgbToHsl(color).l));

  useEffect(() => {
    setLightness(Math.round(rgbToHsl(color).l));
    // Only re-sync when the tool changes, not on every slider-driven colour change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  return (
    <div
      data-testid={`tool-color-picker-${toolId}`}
      className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {toolName} colour
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              resetToolColor(toolId);
              setLightness(Math.round(rgbToHsl(DEFAULT_TOOL_COLORS[toolId]).l));
            }}
            className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Done
          </button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`Set ${toolName} colour ${preset}`}
            data-color={preset}
            onClick={() => {
              setToolColor(toolId, preset);
              setLightness(Math.round(rgbToHsl(preset).l));
            }}
            className={cn(
              "h-6 w-full rounded-md border transition-transform hover:scale-105",
              color.toLowerCase() === preset.toLowerCase()
                ? "border-white ring-2 ring-white/60"
                : "border-white/20",
            )}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Dark</span>
          <span className="font-mono">{color.toUpperCase()}</span>
          <span>Light</span>
        </div>
        <input
          type="range"
          min={5}
          max={95}
          step={1}
          value={lightness}
          aria-label={`${toolName} shade`}
          data-testid={`tool-shade-${toolId}`}
          onChange={(e) => {
            const next = Number(e.target.value);
            setLightness(next);
            setToolColor(toolId, withLightness(color, next));
          }}
          className="h-2 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, ${withLightness(color, 8)}, ${withLightness(
              color,
              50,
            )}, ${withLightness(color, 92)})`,
          }}
        />
      </div>
    </div>
  );
}
