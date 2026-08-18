// Protocol v0 client — see docs/earshot-implementation-plan.md §3 (FROZEN).
export type NeighborInfo = { id: string; pan: number; hushes: number };
export type Roster = { t: "roster"; neighbors: NeighborInfo[]; self_hushes: number; refresh_s: number };
export type HushCount = { t: "hushcount"; id: string; n: number };
export type SigIn = { t: "sig"; from: string; payload: Record<string, unknown> };
export type Bye = { t: "bye"; id: string };
export type ServerMsg = Roster | HushCount | SigIn | Bye | { t: "error"; reason: string };

const HEARTBEAT_MS = 15_000;

export class Coordinator {
  private ws?: WebSocket;
  private hb?: number;
  onmessage: (m: ServerMsg) => void = () => {};
  onstatus: (s: "connecting" | "open" | "closed") => void = () => {};

  constructor(
    private url: string,
    private id: string,
    private getPosition: () => Promise<{ lat: number; lon: number }>,
  ) {}

  connect(): void {
    this.onstatus("connecting");
    this.ws = new WebSocket(this.url);
    this.ws.onopen = async () => {
      this.send({ t: "hello", id: this.id, v: 0 });
      await this.beat();
      this.hb = window.setInterval(() => this.beat(), HEARTBEAT_MS);
      this.onstatus("open");
    };
    this.ws.onmessage = (e) => this.onmessage(JSON.parse(e.data) as ServerMsg);
    this.ws.onclose = () => {
      window.clearInterval(this.hb);
      this.onstatus("closed");
      window.setTimeout(() => this.connect(), 2000 + Math.random() * 3000); // retry w/ jitter
    };
  }

  private async beat(): Promise<void> {
    const { lat, lon } = await this.getPosition();
    this.send({ t: "pos", lat, lon });
  }

  hush(target: string): void { this.send({ t: "hush", target }); }
  unhush(target: string): void { this.send({ t: "unhush", target }); }
  sig(to: string, payload: Record<string, unknown>): void { this.send({ t: "sig", to, payload }); }

  private send(o: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }
}

export function sessionId(): string {
  const k = "earshot-id";
  let id = localStorage.getItem(k);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
  return id;
}

/** Real GPS, or ?spoof=lat,lon for desktop testing (dev builds). */
export function positionSource(): () => Promise<{ lat: number; lon: number }> {
  const spoof = new URLSearchParams(location.search).get("spoof");
  if (spoof) {
    const [lat, lon] = spoof.split(",").map(Number);
    return async () => ({ lat, lon });
  }
  return () =>
    new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
        rej,
        { enableHighAccuracy: true, maximumAge: 10_000 },
      ),
    );
}
