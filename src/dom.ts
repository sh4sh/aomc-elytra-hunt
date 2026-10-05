// Small helpers for the page and the text shown on it.

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const fmt = (n: number) => n.toLocaleString();
/** Coordinates the way Minecraft writes them. No thousands separators, so they can be typed straight in. */
export const xzText = (c: { x: number; z: number }) => `x: ${c.x}, z: ${c.z}`;

/** Hand the visitor a text file to save. */
export function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
