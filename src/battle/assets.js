// Optional drawn assets. Drop PNGs into src/assets/battle/ (see README there);
// anything missing falls back to the procedural pixel drawings.
const files = import.meta.glob("../assets/battle/*.png", { eager: true, query: "?url", import: "default" });

const urls = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split("/").pop().replace(/\.png$/, ""), url]));
const images = new Map();
const tinted = new Map();

export const ASSET_NAMES = ["gourd-1", "gourd-2", "gourd-3", "gourd-4", "gourd-shard-left", "gourd-shard-right", "banner", "pole", "ground"];

export function hasAsset(name) {
  return Boolean(urls[name]);
}

export function loadAssets(onReady) {
  const pending = Object.entries(urls).filter(([name]) => !images.has(name));
  if (!pending.length) { onReady?.(); return; }
  let remaining = pending.length;
  pending.forEach(([name, url]) => {
    const image = new Image();
    image.onload = image.onerror = () => { remaining -= 1; if (remaining === 0) onReady?.(); };
    image.src = url;
    images.set(name, image);
  });
}

export function getAsset(name) {
  const image = images.get(name);
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}

// Grayscale assets are tinted per team once and cached.
export function getTintedAsset(name, color) {
  const key = `${name}:${color}`;
  if (tinted.has(key)) return tinted.get(key);
  const image = getAsset(name);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);
  tinted.set(key, canvas);
  return canvas;
}
