// Deterministic identicon + handle from a user id (matches the approved mock).
export function identicon(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0), h / 2 ** 32);
  const hues = [38, 32, 44, 26, 50];
  const hue = hues[Math.floor(rnd() * hues.length)];
  const shapes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const cx = 10 + rnd() * 32, cy = 10 + rnd() * 32, r = 6 + rnd() * 14, rot = rnd() * 360;
    const light = 30 + i * 16, kind = rnd();
    const fill = `hsl(${hue} ${55 + rnd() * 20}% ${light}%)`;
    if (kind < 0.4) shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`);
    else if (kind < 0.75) shapes.push(`<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="${r / 2.5}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`);
    else shapes.push(`<polygon points="${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`);
  }
  return `<svg viewBox="0 0 52 52"><rect width="52" height="52" fill="hsl(${hue} 30% 12%)"/>${shapes.join("")}</svg>`;
}

const HANDLES = ["Kestrel","Bramble","Wren","Moss","Tarn","Fenn","Sorrel","Heath","Lark","Alder",
  "Rowan","Teal","Sedge","Vetch","Osier","Merle","Coot","Dunlin","Petrel","Brant"];

export function handle(id: string): string {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `${HANDLES[h % HANDLES.length]}-${(h % 97).toString().padStart(2, "0")}`;
}

// hush affordance: mixer fader pulled low (decision D4)
export const hushIcon =
  '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M10 3v14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '<rect x="6.4" y="12.2" width="7.2" height="3.4" rx="1.7" fill="currentColor"/>' +
  '<path d="M5 3.2h2.4M12.6 3.2H15M5 7.5h2.4M12.6 7.5H15" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>' +
  "</svg>";
