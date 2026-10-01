// 生成 icon.png(160x160) 与 preview.png(1024x768) —— 零依赖 PNG 编码器
// 视觉基准：docs/12（accent 渐变 #5458e8→#7b6cf0，圆角卡片，浅色画布）
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 画布与绘图原语 ----
const canvas = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 4) });
const blend = (c, x, y, [r, g, b, a]) => {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || a <= 0) return;
  const i = (y * c.w + x) * 4, ia = a / 255;
  c.px[i] = Math.round(r * ia + c.px[i] * (1 - ia));
  c.px[i + 1] = Math.round(g * ia + c.px[i + 1] * (1 - ia));
  c.px[i + 2] = Math.round(b * ia + c.px[i + 2] * (1 - ia));
  c.px[i + 3] = Math.min(255, c.px[i + 3] + a);
};
const fillRect = (c, x0, y0, w, h, col) => {
  for (let y = Math.max(0, y0); y < Math.min(c.h, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(c.w, x0 + w); x++) blend(c, x, y, col);
};
const roundedRect = (c, x0, y0, w, h, rad, col) => {
  for (let y = Math.max(0, y0 - 1); y < Math.min(c.h, y0 + h + 1); y++)
    for (let x = Math.max(0, x0 - 1); x < Math.min(c.w, x0 + w + 1); x++) {
      const dx = Math.max(x0 + rad - x, x - (x0 + w - 1 - rad), 0);
      const dy = Math.max(y0 + rad - y, y - (y0 + h - 1 - rad), 0);
      const d = Math.hypot(dx, dy);
      if (d <= rad) blend(c, x, y, col);
      else if (d <= rad + 1) blend(c, x, y, [col[0], col[1], col[2], Math.round(col[3] * (rad + 1 - d))]);
    }
};
const lerp = (a, b, t) => a + (b - a) * t;
const gradCol = (t) => [Math.round(lerp(84, 123, t)), Math.round(lerp(88, 108, t)), Math.round(lerp(232, 240, t)), 255];

// ---- 图标：渐变圆角方 + 白色试卷 + 勾 ----
function genIcon(size) {
  const c = canvas(size, size);
  const pad = Math.round(size * 0.075), rad = Math.round(size * 0.22);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(Math.max(pad + rad - x, x - (size - 1 - pad - rad), 0), Math.max(pad + rad - y, y - (size - 1 - pad - rad), 0));
      if (d <= rad) {
        const t = (x + y) / (2 * size);
        blend(c, x, y, gradCol(t));
      }
    }
  // 白色试卷（右上折角）
  const dx0 = Math.round(size * 0.30), dy0 = Math.round(size * 0.22), dw = Math.round(size * 0.40), dh = Math.round(size * 0.56);
  roundedRect(c, dx0, dy0, dw, dh, Math.round(size * 0.05), [255, 255, 255, 255]);
  // 折角：左上到右下的渐变小三角留白 —— 改为右下角"勾"圆徽
  const cx = dx0 + dw, cy = dy0 + dh, r = Math.round(size * 0.14);
  for (let y = cy - r - 1; y <= cy + r + 1; y++)
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r - 1) blend(c, x, y, [24, 154, 88, 255]);
      else if (d <= r) blend(c, x, y, [24, 154, 88, 140]);
    }
  // 勾（两段粗线）
  const line = (x1, y1, x2, y2, th) => {
    const steps = Math.hypot(x2 - x1, y2 - y1) * 2;
    for (let i = 0; i <= steps; i++) {
      const x = lerp(x1, x2, i / steps), y = lerp(y1, y2, i / steps);
      for (let oy = -th; oy <= th; oy++) for (let ox = -th; ox <= th; ox++)
        if (ox * ox + oy * oy <= th * th) blend(c, Math.round(x + ox), Math.round(y + oy), [255, 255, 255, 255]);
    }
  };
  line(cx - r * 0.45, cy, cx - r * 0.1, cy + r * 0.38, Math.max(1, Math.round(size * 0.016)));
  line(cx - r * 0.1, cy + r * 0.38, cx + r * 0.5, cy - r * 0.35, Math.max(1, Math.round(size * 0.016)));
  // 试卷题行（浅靛短线）
  const lw = Math.round(dw * 0.56), lh = Math.max(1, Math.round(size * 0.022));
  fillRect(c, dx0 + Math.round(dw * 0.16), dy0 + Math.round(dh * 0.18), lw, lh, [84, 88, 232, 200]);
  fillRect(c, dx0 + Math.round(dw * 0.16), dy0 + Math.round(dh * 0.34), Math.round(lw * 0.8), lh, [84, 88, 232, 130]);
  fillRect(c, dx0 + Math.round(dw * 0.16), dy0 + Math.round(dh * 0.50), Math.round(lw * 0.9), lh, [84, 88, 232, 130]);
  return encodePNG(size, size, c.px);
}

// ---- 预览图 1024x768：入口页几何 mock ----
function genPreview() {
  const W = 1024, H = 768, c = canvas(W, H);
  fillRect(c, 0, 0, W, H, [244, 245, 248, 255]);
  // 顶栏
  fillRect(c, 0, 0, W, 56, [255, 255, 255, 255]);
  fillRect(c, 0, 55, W, 1, [230, 233, 239, 255]);
  roundedRect(c, 24, 14, 28, 28, 8, [84, 88, 232, 255]);
  fillRect(c, 64, 20, 96, 14, [22, 26, 33, 235]);
  roundedRect(c, 760, 16, 76, 24, 12, [84, 88, 232, 26]);
  fillRect(c, 776, 26, 44, 5, [84, 88, 232, 220]);
  // hero 卡
  roundedRect(c, 24, 80, W - 48, 128, 16, [255, 255, 255, 255]);
  fillRect(c, 52, 104, 220, 16, [22, 26, 33, 235]);
  fillRect(c, 52, 130, 150, 10, [138, 146, 161, 200]);
  roundedRect(c, 52, 152, 380, 6, 3, [84, 88, 232, 255]);
  roundedRect(c, 52, 152, 228, 6, 3, [84, 88, 232, 255]);
  roundedRect(c, 812, 118, 160, 44, 10, [84, 88, 232, 255]);
  fillRect(c, 868, 136, 48, 8, [255, 255, 255, 235]);
  // 进度环
  const rcx = 940, rcy = 144, rr = 34;
  for (let y = rcy - rr - 2; y <= rcy + rr + 2; y++)
    for (let x = rcx - rr - 2; x <= rcx + rr + 2; x++) {
      const d = Math.hypot(x - rcx, y - rcy);
      const ang = Math.atan2(y - rcy, x - rcx);
      if (d >= rr - 5 && d <= rr) { blend(c, x, y, [241, 242, 246, 255]); if (ang <= 0.9) blend(c, x, y, [24, 154, 88, 255]); }
    }
  // 六张模式卡（2 行 3 列）
  const cw = 308, ch = 120, gx = 24, gy = 16;
  for (let i = 0; i < 6; i++) {
    const x = gx + (i % 3) * (cw + gx), y = 232 + Math.floor(i / 3) * (ch + gy);
    roundedRect(c, x, y, cw, ch, 14, [255, 255, 255, 255]);
    roundedRect(c, x + 20, y + 20, 38, 38, 10, [84, 88, 232, 28]);
    fillRect(c, x + 30, y + 32, 18, 14, [84, 88, 232, 190]);
    fillRect(c, x + 72, y + 26, 110, 13, [22, 26, 33, 225]);
    fillRect(c, x + 72, y + 48, 150, 9, [138, 146, 161, 170]);
    fillRect(c, x + 20, y + 86, 60, 8, [84, 88, 232, 60]);
  }
  // 底部统计条
  roundedRect(c, 24, 620, W - 48, 110, 16, [255, 255, 255, 255]);
  for (let i = 0; i < 4; i++) {
    const x = 52 + i * 240;
    fillRect(c, x, 644, 90, 10, [138, 146, 161, 170]);
    fillRect(c, x, 664, 120, 22, [22, 26, 33, 235]);
    const bw = [0.86, 0.76, 0.66, 0.4][i];
    roundedRect(c, x, 698, 200, 8, 4, [241, 242, 246, 255]);
    roundedRect(c, x, 698, Math.round(200 * bw), 8, 4, [84, 88, 232, 235]);
  }
  return encodePNG(W, H, c.px);
}

const root = fileURLToPath(new URL("..", import.meta.url));
writeFileSync(`${root}icon.png`, genIcon(160));
writeFileSync(`${root}preview.png`, genPreview());
console.log("icon.png", genIcon(160).length, "bytes; preview.png", genPreview().length, "bytes");
