"use client";

// The office's view controls: which room, how the agents are drawn, where the camera stands, and (from above) the zoom.
// A choice changes only what this browser shows.
import type { Lang } from "../../lib/types";
import { type AgentStyleId, type CameraViewMode, type EnvironmentPresetId, OFFICE_WORDS, PRESETS, STYLES, VIEWS } from "./presets";
import type { Agent, AgentId } from "./types";

export type OfficeView = { preset: EnvironmentPresetId; style: AgentStyleId; view: CameraViewMode };

export function OfficeControls({
  lang,
  value,
  onChange,
  agents,
  followed,
  onFollow,
  zoom,
}: {
  lang: Lang;
  value: OfficeView;
  onChange(next: Partial<OfficeView>): void;
  agents: Agent[];
  followed: AgentId;
  onFollow(id: AgentId): void;
  zoom: { zoomIn(): void; zoomOut(): void; reset(): void } | null;
}) {
  const w = OFFICE_WORDS[lang];
  return (
    <div className="munshi-controls">
      <label>
        {w.room}
        <select value={value.preset} onChange={(e) => onChange({ preset: e.target.value as EnvironmentPresetId })}>
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {w.preset[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {w.look}
        <select value={value.style} onChange={(e) => onChange({ style: e.target.value as AgentStyleId })}>
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {w.style[s]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="sr-only">{w.camera}</legend>
        {VIEWS.map((v) => (
          <button key={v} type="button" aria-pressed={value.view === v} onClick={() => onChange({ view: v })}>
            {w.view[v]}
          </button>
        ))}
      </fieldset>
      {value.view === "pov_agent" && (
        <label>
          {w.follow}
          <select value={followed} onChange={(e) => onFollow(e.target.value as AgentId)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {zoom && (
        <fieldset>
          <legend className="sr-only">{w.zoom}</legend>
          <button type="button" onClick={zoom.zoomOut} aria-label={w.zoomOut} title={w.zoomOut}>
            −
          </button>
          <button type="button" onClick={zoom.reset}>
            {w.reset}
          </button>
          <button type="button" onClick={zoom.zoomIn} aria-label={w.zoomIn} title={w.zoomIn}>
            +
          </button>
        </fieldset>
      )}
    </div>
  );
}
