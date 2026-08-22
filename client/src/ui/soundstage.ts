// The live screen: ruler + pins, measured leader lines, avatar strip, hush pills.
// Faithful port of the approved mocks v4 (docs/situated-audio-chat-mocks.html).
import { state } from "../state/store";
import { handle, hushIcon, identicon } from "./identicon";

export interface SoundstageHooks {
  onHush: (id: string) => void;
  onUnhush: (id: string) => void;
  micOpen: boolean;
}

export function mountSoundstage(root: HTMLElement, hooks: SoundstageHooks): { render: () => void } {
  root.innerHTML = `
    <div class="appbar">
      <div class="logo">Earshot<span>.</span></div>
      <div class="status">
        <span id="conn" class="live">● LIVE</span><br>
        <span id="counts">—</span>
      </div>
    </div>
    <div class="soundstage">
      <div class="ruler" id="ruler" aria-hidden="true">
        <div class="axis"></div>
        <div class="lbl" style="left:0%">L</div>
        <div class="lbl" style="left:50%">YOU</div>
        <div class="lbl" style="left:100%">R</div>
      </div>
    </div>
    <svg class="leaders" id="leaders" aria-hidden="true" preserveAspectRatio="none"></svg>
    <div class="strip-outer" id="stripOuter">
      <div class="strip" id="strip" aria-label="Neighbours sorted left to right"></div>
    </div>
    <div id="empty" class="empty" hidden>no neighbours in earshot yet — waiting for others to join…</div>
    <div class="spacer"></div>
    <div class="mic">
      <span class="dot ${hooks.micOpen ? "open" : ""}" aria-hidden="true"></span>
      <span>${hooks.micOpen
        ? "<b>Your mic is open.</b> Neighbours hear you from your position."
        : "<b>Listening only.</b> Mic is unavailable or was denied — you can hear neighbours, they can't hear you."}</span>
    </div>`;

  const ruler = root.querySelector("#ruler") as HTMLElement;
  const leaders = root.querySelector("#leaders") as SVGSVGElement;
  const strip = root.querySelector("#strip") as HTMLElement;
  const stripOuter = root.querySelector("#stripOuter") as HTMLElement;
  const conn = root.querySelector("#conn") as HTMLElement;
  const counts = root.querySelector("#counts") as HTMLElement;
  const empty = root.querySelector("#empty") as HTMLElement;

  interface Person { id: string; pan: number; hushes: number; me: boolean }

  function roster(): Person[] {
    const nbrs: Person[] = state.neighbors
      .map((n) => ({ id: n.id, pan: n.pan, hushes: n.hushes, me: false }))
      .sort((a, b) => a.pan - b.pan);
    const me: Person = { id: "me", pan: 0, hushes: state.selfHushes, me: true };
    const at = nbrs.findIndex((n) => n.pan > 0);
    if (at === -1) nbrs.push(me); else nbrs.splice(at, 0, me);
    return nbrs;
  }

  function render(): void {
    const people = roster();
    conn.textContent = state.status === "open" ? "● LIVE" : state.status === "connecting" ? "● CONNECTING" : "● RECONNECTING";
    conn.className = state.status === "open" ? "live" : "off";
    counts.textContent = `${people.length - 1} neighbour${people.length === 2 ? "" : "s"} · refresh in ${fmt(state.refreshS)}`;
    empty.hidden = people.length > 1;

    // pins + ticks
    ruler.querySelectorAll(".pin,.tick").forEach((e) => e.remove());
    for (let t = 0; t <= 10; t++) {
      const tick = document.createElement("div");
      tick.className = "tick" + (t === 5 ? " mid" : "");
      tick.style.left = `${t * 10}%`;
      ruler.appendChild(tick);
    }
    for (const p of people) {
      const pin = document.createElement("div");
      const talking = state.talking.has(p.id);
      pin.className = "pin" + (p.me ? " you" : "") + (talking ? " talking" : "") + (p.hushes > 0 && !p.me ? " hushed" : "");
      pin.style.left = `${50 + p.pan * 50}%`;
      pin.innerHTML = '<span class="ring"></span><span class="ring r2"></span>';
      ruler.appendChild(pin);
    }

    // strip
    strip.innerHTML = "";
    for (const p of people) {
      const tile = document.createElement("div");
      const talking = state.talking.has(p.id);
      const mine = state.myHushes.has(p.id);
      tile.className = "tile" + (talking ? " talking" : "") + (p.me ? " me" : "");
      tile.dataset.att = p.me ? "0" : String(Math.min(p.hushes, 5));
      const pill = p.me
        ? `<span class="hush-pill static ${p.hushes === 0 ? "zero" : ""}" title="${p.hushes} active hushes on you">${hushIcon}<span class="cnt">${p.hushes}</span></span>`
        : `<button class="hush-pill ${mine ? "active" : ""} ${p.hushes === 0 ? "zero" : ""}" data-id="${p.id}" aria-pressed="${mine}" title="${mine ? "Undo your hush" : "Hush for 1 hour"}">${hushIcon}<span class="cnt">${p.hushes}</span></button>`;
      tile.innerHTML = `
        <div class="avatar">${identicon(p.me ? "me" : p.id)}</div>
        <div class="tname">${p.me ? "You" : handle(p.id)}</div>
        ${pill}`;
      strip.appendChild(tile);
    }
    strip.querySelectorAll<HTMLButtonElement>("button.hush-pill").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.id!;
        state.myHushes.has(id) ? hooks.onUnhush(id) : hooks.onHush(id);
      }),
    );

    drawLeaders(people);
  }

  function drawLeaders(people: Person[]): void {
    requestAnimationFrame(() => {
      const box = leaders.getBoundingClientRect();
      if (box.width === 0) return;
      leaders.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const pins = ruler.querySelectorAll(".pin");
      const avs = strip.querySelectorAll(".tile .avatar");
      let paths = "";
      people.forEach((p, i) => {
        const pb = pins[i]?.getBoundingClientRect();
        const ab = avs[i]?.getBoundingClientRect();
        if (!pb || !ab) return;
        const x1 = pb.left + pb.width / 2 - box.left;
        const x2 = ab.left + ab.width / 2 - box.left;
        const h = box.height;
        paths += `<path class="${state.talking.has(p.id) ? "talking" : ""}" d="M${x1.toFixed(1)},0 C${x1.toFixed(1)},${(h * 0.55).toFixed(1)} ${x2.toFixed(1)},${(h * 0.45).toFixed(1)} ${x2.toFixed(1)},${h}"/>`;
      });
      leaders.innerHTML = paths;
    });
  }

  function fmt(s: number): string {
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  addEventListener("resize", render);
  stripOuter.addEventListener("scroll", () => drawLeaders(roster()));
  return { render };
}
