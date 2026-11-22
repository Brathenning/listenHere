// engine/time-axis.js
//
// Time-axis tick rendering for the waveform overlay canvases. Pure drawing over
// its arguments — no shared module state, no DOM, no WaveSurfer access — so it
// carries no imports back to listen.js.
//
// Extracted from listen.js (Phase 1 refactor, increment 4). Behaviour-preserving.

const _NICE_INTERVALS = [
  0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600,
];

/** Format seconds for tick labels. */
function _formatTickTime(t) {
  if (t < 60) {
    // Show sub-second decimals only for small intervals
    return t % 1 === 0 ? String(t) : t.toFixed(1);
  }
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}

/**
 * Draw subtle time ticks at the top edge of a waveform overlay canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} viewW  visible viewport width in px
 * @param {number} h      canvas height
 * @param {number} fullW  full zoomed width of the waveform in px
 * @param {number} dur    duration in seconds
 * @param {number} scrollLeft  current scroll offset in px
 */
export function drawTimeTicks(ctx, viewW, h, fullW, dur, scrollLeft, bgColor, textColor, tickColor) {
  if (dur <= 0 || fullW <= 0) return;
  const pxPerSec = fullW / dur;
  const visibleSec = viewW / pxPerSec;

  // Choose a "nice" interval so we get roughly 60 ticks in the viewport
  const rawInterval = visibleSec / 60;
  const interval =
    _NICE_INTERVALS.find((n) => n >= rawInterval) ||
    _NICE_INTERVALS[_NICE_INTERVALS.length - 1];

  // Label every 2nd tick
  const labelEvery = 2;

  const startTime = (scrollLeft / fullW) * dur;
  const endTime = ((scrollLeft + viewW) / fullW) * dur;
  const firstTick = Math.ceil(startTime / interval) * interval;

  ctx.save();
  ctx.lineWidth = 1;

  for (let t = firstTick; t <= endTime + interval * 0.01; t += interval) {
    const x = Math.round((t / dur) * fullW - scrollLeft) + 0.5;
    if (x < -1 || x > viewW + 1) continue;

    // Label every 2nd tick
    const tickIndex = Math.round(t / interval);
    const isLabelled = tickIndex % labelEvery === 0;
    const tickH = isLabelled ? 7 : 4;

    ctx.strokeStyle = tickColor || "#505050";
    ctx.globalAlpha = isLabelled ? 0.75 : 0.35;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, tickH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (isLabelled) {
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      const text = _formatTickTime(t);
      const tw = ctx.measureText(text).width;
      const pad = 1;
      ctx.fillStyle = bgColor || "rgba(255, 255, 255, 0.7)";
      ctx.fillRect(x - tw / 2 - pad, tickH, tw + pad * 2, 10);
      ctx.fillStyle = textColor || "rgba(60, 60, 60, 0.7)";
      ctx.fillText(text, x, tickH + 9);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Rulers for correction mode's strip and reference pane (0.133.0): a band
// along one edge, its ticks rising from the edge that faces the content, a
// label beside each major tick. Steps go down to 10 ms, since a correction
// page can be a second or two wide.
// ---------------------------------------------------------------------------

/** [major, minor] step pairs in seconds, finest first. */
const _RULER_STEPS = [
  [0.01, 0.002], [0.02, 0.005], [0.05, 0.01], [0.1, 0.02], [0.2, 0.05],
  [0.5, 0.1], [1, 0.2], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 10],
  [60, 15], [120, 30], [300, 60], [600, 120], [1200, 300], [3600, 600],
];

/** The step pair whose major ticks stand at least `minLabelPx` apart. */
export function rulerSteps(pxPerSec, minLabelPx = 70) {
  for (const s of _RULER_STEPS) if (s[0] * pxPerSec >= minLabelPx) return s;
  return _RULER_STEPS[_RULER_STEPS.length - 1];
}

/** m:ss with as many decimals as the major step needs ("1:02.35"). */
export function formatRulerTime(t, major) {
  const dec = major >= 1 ? 0 : major >= 0.1 ? 1 : 2;
  const neg = t < 0;
  const a = Math.abs(t) + 1e-9;
  const m = Math.floor(a / 60);
  const s = (a - m * 60).toFixed(dec);
  return `${neg ? "-" : ""}${m}:${s.padStart(dec ? dec + 3 : 2, "0")}`;
}

/**
 * Draw one ruler band.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {number} o.w        band width in px
 * @param {number} o.y0       the band's top edge
 * @param {number} o.h        band height
 * @param {"top"|"bottom"} o.edge  which edge of the pane the band lies on;
 *                            its ticks rise from the OTHER side (the content's)
 * @param {(t: number) => number} o.timeToX
 * @param {number} o.t0, o.t1 the visible time range
 * @param {number} o.pxPerSec
 * @param {{bg?: string, tick?: string, text?: string}} [o.colors]
 * @returns {{major: number, minor: number, labels: {t: number, x: number, text: string}[]}}
 */
export function drawRuler(ctx, o) {
  const { w, y0, h, edge, timeToX, t0, t1, pxPerSec } = o;
  const c = o.colors || {};
  const out = { major: 0, minor: 0, labels: [] };
  if (!(pxPerSec > 0) || !(w > 0) || !(h > 0) || !(t1 > t0)) return out;
  const [major, minor] = rulerSteps(pxPerSec);
  out.major = major;
  out.minor = minor;
  ctx.save();
  ctx.fillStyle = c.bg || "rgba(241, 245, 249, 0.9)";
  ctx.fillRect(0, y0, w, h);
  // The content-facing edge: ticks start there and point outwards.
  const base = edge === "top" ? y0 + h : y0;
  const dir = edge === "top" ? -1 : 1;
  ctx.strokeStyle = c.tick || "rgba(71, 85, 105, 0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, base + 0.5 * -dir);
  ctx.lineTo(w, base + 0.5 * -dir);
  ctx.stroke();
  const kMinor = Math.round(major / minor);
  const first = Math.floor(t0 / minor);
  const last = Math.ceil(t1 / minor);
  ctx.font = "9px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (let k = first; k <= last; k++) {
    const t = k * minor;
    const x = Math.round(timeToX(t)) + 0.5;
    if (x < -40 || x > w + 1) continue;
    const isMajor = k % kMinor === 0;
    const len = isMajor ? h - 3 : 3;
    ctx.globalAlpha = isMajor ? 0.9 : 0.55;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, base + dir * len);
    ctx.stroke();
    if (isMajor) {
      const text = formatRulerTime(t, major);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text || "#334155";
      // Beside the tick, in the half of the band away from the minor ticks.
      ctx.fillText(text, x + 3, base + dir * (h / 2 + 1));
      if (x >= 0 && x <= w) out.labels.push({ t, x, text });
    }
  }
  ctx.restore();
  return out;
}
