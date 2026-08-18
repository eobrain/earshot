// M0 stub: proves the wss loop end-to-end. The mocks-v4 UI ports in at M3;
// its source lives in docs/situated-audio-chat-mocks.html.
import { Coordinator, positionSource, sessionId, type ServerMsg } from "./ws/client";

const el = document.getElementById("status")!;
const log = (s: string) => { el.textContent = s; };

const proto = location.protocol === "https:" ? "wss" : "ws";
const co = new Coordinator(`${proto}://${location.host}/ws`, sessionId(), positionSource());
co.onstatus = (s) => log(`coordinator: ${s}`);
co.onmessage = (m: ServerMsg) => {
  if (m.t === "roster") log(`roster: ${m.neighbors.length} neighbours · refresh in ${m.refresh_s}s`);
};
co.connect();
