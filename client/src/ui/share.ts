// Invite/share affordance: Web Share API on mobile (posts to any social app),
// clipboard fallback on desktop, with a small confirmation toast.

const INVITE_TEXT =
  "I'm on Earshot — spatial audio chat with whoever's around you. Put headphones on and say hi:";

export async function shareInvite(): Promise<void> {
  const url = location.origin;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Earshot", text: INVITE_TEXT, url });
      return;
    } catch {
      return; // user dismissed the share sheet — not an error
    }
  }
  try {
    await navigator.clipboard.writeText(`${INVITE_TEXT} ${url}`);
    toast("Invite copied — paste it anywhere");
  } catch {
    toast(url); // last resort: at least show the link
  }
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;

function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove("show"), 2600);
}

export const shareIcon =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<circle cx="15" cy="4.5" r="2.6" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="5" cy="10" r="2.6" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="15" cy="15.5" r="2.6" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M7.4 8.8l5.2-3M7.4 11.2l5.2 3" stroke="currentColor" stroke-width="1.5"/>' +
  "</svg>";
