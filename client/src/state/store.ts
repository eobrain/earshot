import type { NeighborInfo } from "../ws/client";

export type ConnStatus = "connecting" | "open" | "closed";

export interface State {
  status: ConnStatus;
  neighbors: NeighborInfo[];   // sorted by pan (server guarantees; we re-sort defensively)
  selfHushes: number;
  refreshS: number;            // local countdown, reset by each roster
  myHushes: Set<string>;       // targets I currently hush (local toggle state)
  talking: Set<string>;        // ids currently talking (wired at M2)
}

export const state: State = {
  status: "connecting",
  neighbors: [],
  selfHushes: 0,
  refreshS: 0,
  myHushes: new Set(),
  talking: new Set(),
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): void { listeners.add(fn); }
export function notify(): void { for (const fn of listeners) fn(); }
