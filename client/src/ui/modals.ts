// First-run location consent + per-session headphones gate (user stories 1 & 2).
export function locationModal(onOk: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "modal-scrim";
  el.innerHTML = `
    <div class="card location">
      <div class="kicker">Before we start</div>
      <h1>Earshot uses your precise location</h1>
      <p>Your position is only used to work out <strong>where your neighbours are relative to you</strong>, so their voices come from the right direction.</p>
      <div class="pledge">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l5 2.2v3.5c0 3.4-2.1 5.9-5 7.3-2.9-1.4-5-3.9-5-7.3V3.7L8 1.5z" stroke="#F5A83C" stroke-width="1.3"/><path d="M5.6 8l1.7 1.7 3.1-3.4" stroke="#F5A83C" stroke-width="1.3" stroke-linecap="round"/></svg>
        <span>Your location is <b>never stored</b> — it's used in the moment, then discarded.</span>
      </div>
      <button class="ok">OK</button>
      <p style="text-align:center;margin:12px 0 0;font-size:12px">Next, your phone will ask for permission.</p>
    </div>`;
  el.querySelector("button.ok")!.addEventListener("click", onOk);
  return el;
}

export function headphonesModal(onOk: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "modal-scrim";
  el.innerHTML = `
    <div class="card phones">
      <svg width="88" height="72" viewBox="0 0 88 72" fill="none" aria-hidden="true" style="display:block;margin:0 auto">
        <path d="M14 46v-8C14 21 27.4 8 44 8s30 13 30 30v8" stroke="#F3E9D2" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="8" y="44" width="16" height="22" rx="6" fill="#F5A83C"/>
        <rect x="64" y="44" width="16" height="22" rx="6" fill="#F5A83C"/>
      </svg>
      <h1>Headphones on!</h1>
      <div class="lr"><span>L ◄</span><span>► R</span></div>
      <p style="max-width:30ch;margin-left:auto;margin-right:auto">Earshot places each voice around you in <strong>stereo space</strong>. It only works well with stereo headphones or earbuds.</p>
      <button class="ok" style="margin-top:14px">OK</button>
    </div>`;
  // This OK tap is also the user gesture that will unlock the AudioContext at M2.
  el.querySelector("button.ok")!.addEventListener("click", onOk);
  return el;
}
