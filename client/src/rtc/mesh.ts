// One RTCPeerConnection per neighbor edge, perfect-negotiation pattern.
// Politeness from the frozen rule (implementation plan §1): the LOWER id is
// the impolite/offering side; the higher id is polite and yields on glare.
import type { Coordinator } from "../ws/client";
import type { AudioEngine } from "../audio/engine";

interface PeerConn {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export class Mesh {
  private peers = new Map<string, PeerConn>();

  constructor(
    private localId: string,
    private co: Coordinator,
    private engine: AudioEngine,
    private iceServers: RTCIceServer[],
  ) {}

  get myId(): string {
    return this.localId;
  }

  /** Reconcile connections against the latest roster (architecture §5). */
  sync(neighborIds: string[]): void {
    const want = new Set(neighborIds);
    for (const id of this.peers.keys()) if (!want.has(id)) this.close(id);
    for (const id of want) if (!this.peers.has(id)) this.open(id);
  }

  private open(id: string): void {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const conn: PeerConn = { pc, makingOffer: false, ignoreOffer: false };
    this.peers.set(id, conn);

    for (const track of this.engine.mic?.getTracks() ?? []) pc.addTrack(track, this.engine.mic!);

    pc.ontrack = (e) => this.engine.attach(id, e.streams[0] ?? new MediaStream([e.track]));
    pc.onicecandidate = (e) => { if (e.candidate) this.co.sig(id, { candidate: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      // Deterministic initiator: only create an offer if this.localId < peerId
      if (this.localId >= id) return;
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.co.sig(id, { description: pc.localDescription!.toJSON() });
      } catch (err) {
        console.warn(`[mesh] negotiation error with ${id}:`, err);
      } finally {
        conn.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };
  }

  async handleSig(from: string, payload: any): Promise<void> {
    let conn = this.peers.get(from);
    if (!conn) return; // signaling from someone not (yet) in our roster: drop
    const { pc } = conn;
    const polite = this.localId > from; // lower id offers; higher id is polite

    if (payload.description) {
      const desc = payload.description as RTCSessionDescriptionInit;
      const isOffer = desc.type === "offer";
      const collision = isOffer && (conn.makingOffer || pc.signalingState !== "stable");
      conn.ignoreOffer = !polite && collision;
      if (conn.ignoreOffer) return;

      if (desc.type === "answer" && pc.signalingState !== "have-local-offer") {
        return; // ignore answer if not expecting one
      }

      if (collision) {
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch {
          // ignore rollback error
        }
      }

      try {
        await pc.setRemoteDescription(desc);
      } catch (err) {
        console.warn(`[mesh] failed to set remote description from ${from}:`, err);
        return;
      }

      if (isOffer) {
        try {
          await pc.setLocalDescription();
          this.co.sig(from, { description: pc.localDescription!.toJSON() });
        } catch (err) {
          console.warn(`[mesh] failed to set local description for answer to ${from}:`, err);
        }
      }
    } else if (payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (e) {
        if (!conn.ignoreOffer) {
          console.warn(`[mesh] failed to add ICE candidate from ${from}:`, e);
        }
      }
    }
  }

  close(id: string): void {
    const conn = this.peers.get(id);
    if (!conn) return;
    conn.pc.close();
    this.peers.delete(id);
    this.engine.detach(id);
  }
}
