// The office's data contract: the scene is driven only by these props.
export type AgentId = "munshi" | "tally" | "ledger" | "dash" | "echo" | "bloom" | "keeper";
export type AgentState = "idle" | "watching" | "thinking" | "drafting" | "walking" | "waiting" | "done" | "blocked";
export interface SourceRef {
  label: string;
}
export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  model: string;
  state: AgentState;
  line?: { text: string; source?: SourceRef };
  /** what the agent is doing, in the scene's fixed words (doing.ts); a line, when given, is shown instead */
  doing?: string;
  walkTo?: "desk" | "lead" | "tray" | "shelf" | "door" | AgentId;
  waitingCount?: number;
}
export interface OfficeEvent {
  id: string;
  kind: "finding" | "draft" | "approved" | "message" | "memory";
  agent: AgentId;
}
export interface OfficeProps {
  shopName: string;
  localTime: string;
  agents: Agent[];
  trayCount: number;
  events: OfficeEvent[];
  sample: boolean;
  onSelectAgent(id: AgentId): void;
  onOpenTray(): void;
  onOpenBrief(): void;
}
export interface GridCoord {
  gx: number;
  gy: number;
}
