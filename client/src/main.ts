import "./style.css";
import { Coordinator, positionSource, sessionId, type ServerMsg } from "./ws/client";
import { state, notify, subscribe } from "./state/store";
import { locationModal, headphonesModal } from "./ui/modals";
import { mountSoundstage } from "./ui/soundstage";
import { AudioEngine } from "./audio/engine";
import { Mesh } from "./rtc/mesh";

const app = document.getElementById("app")!;

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await fetch("/ice");
    if (r.ok) return (await r.json()).iceServers;
  } catch { /* fall through */ }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

async function start(engine: AudioEngine): Promise<void> {
  const myId = sessionId();
  const co = new Coordinator(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    myId,
    positionSource(),
  );

  const mesh = new Mesh(myId, co, engine, await iceServers());

  const stage = mountSoundstage(app, {
    onHush: (id) => { co.hush(id); state.myHushes.add(id); notify(); },
    onUnhush: (id) => { co.unhush(id); state.myHushes.delete(id); notify(); },
  });
  subscribe(stage.render);

  engine.onTalking = (id, talking) => {
    talking ? state.talking.add(id) : state.talking.delete(id);
    notify();
  };
  engine.startVad();

  co.onstatus = (s) => { state.status = s; notify(); };
  co.onmessage = (m: ServerMsg) => {
    if (m.t === "roster") {
      state.neighbors = m.neighbors;
      state.selfHushes = m.self_hushes;
      state.refreshS = m.refresh_s;
      const live = new Set(m.neighbors.map((n) => n.id));
      for (const id of state.myHushes) if (!live.has(id)) state.myHushes.delete(id);
      mesh.sync(m.neighbors.map((n) => n.id));
      for (const n of m.neighbors) {
        engine.setPan(n.id, n.pan);
        engine.setHushCount(n.id, n.hushes);
      }
    } else if (m.t === "sig") {
      mesh.handleSig(m.from, m.payload).catch(() => {});
    } else if (m.t === "hushcount") {
      if (m.id === myId) {
        state.selfHushes = m.n; // hushes on me
      } else {
        const n = state.neighbors.find((x) => x.id === m.id);
        if (n) n.hushes = m.n;
        engine.setHushCount(m.id, m.n);
      }
    } else if (m.t === "bye") {
      state.neighbors = state.neighbors.filter((x) => x.id !== m.id);
      state.myHushes.delete(m.id);
      state.talking.delete(m.id);
      mesh.close(m.id);
    }
    notify();
  };
  co.connect();

  window.setInterval(() => {
    if (state.refreshS > 0) { state.refreshS -= 1; notify(); }
  }, 1000);
}

function boot(): void {
  const seenLocation = localStorage.getItem("earshot-loc-ok") === "1";
  const proceedToHeadphones = () => {
    app.innerHTML = "";
    app.appendChild(
      headphonesModal(async () => {
        // This tap is the user gesture: unlock audio output + open the mic here.
        const engine = new AudioEngine();
        await engine.unlock();
        try { await engine.openMic(); } catch { /* mic denied: listen-only */ }
        app.innerHTML = "";
        start(engine);
      }),
    );
  };
  if (seenLocation) {
    proceedToHeadphones(); // headphones gate shows every session (spec, Normal Use #1)
  } else {
    app.appendChild(
      locationModal(async () => {
        localStorage.setItem("earshot-loc-ok", "1");
        try { await positionSource()(); } catch { /* denied; geolocation will re-prompt on heartbeat */ }
        proceedToHeadphones();
      }),
    );
  }
}
boot();
