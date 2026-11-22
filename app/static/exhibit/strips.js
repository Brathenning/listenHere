// exhibit/strips.js
//
// One horizontal waveform per recording, stacked. The whole interface is these
// strips plus the middle band, so this is where the exhibit's central claim gets
// made visible: the same moment, eight interpretations, all on screen at once.
//
// TWO THINGS ARE LOAD-BEARING HERE, and both are decisions rather than details:
//
// 1. **The renderers carry NO MEDIA.** Every strip is created from `peaks` plus
//    `duration` with no `url` and no `media`, so nothing decodes and nothing
//    downloads to draw a waveform. That is what makes sixteen strips affordable
//    on an iPad — Spike C measured 48 renderers at 3.30 MB of canvas each with
//    zero purges and a 60 fps playhead (plan §4.0a) — and it is also the week-1
//    constraint from §8's closed decisions, because a view that renders from
//    peaks alone is the one that can later show a visitor's own annotation over a
//    recording the kiosk is not licensed to play.
//
// 2. **Playback does not run through WaveSurfer at all.** Exactly one shared
//    `WindowedAudioPlayer` is the clock (see audio.js), and every cursor —
//    including the playing recording's own — is positioned by us, per frame, from
//    that clock projected through `align-core`. Attaching the player as one
//    strip's `media` would make that strip privileged: it would advance itself
//    while the other seven were driven, and the two paths would drift apart at
//    exactly the moments the exhibit is asking visitors to compare. One clock,
//    sixteen followers.
//
// The strips import the vendored WaveSurfer bundles directly, which the boundary
// test permits (they are not first-party modules and cannot reach listen.js).

import WaveSurfer from "../vendor/wavesurfer.esm.js";
import RegionsPlugin from "../vendor/wavesurfer-regions.esm.js";

/**
 * Colours. Not per-recording rainbow: the strips are meant to be read as eight
 * views of one thing, and eight hues invite the visitor to read the colour as
 * meaning something. Grouping colours are the ones that carry meaning here
 * (grouping-core's palette, via the annotations), so the waveform itself stays
 * neutral and the ACTIVE strip is what changes.
 *
 * These are the DEFAULT (dark) theme's values; main.js passes the active
 * theme's set through `opts.colors` (themes.js) — as options, not CSS tokens,
 * because WaveSurfer paints them into canvases.
 */
const DEFAULT_COLORS = {
  wave: "#5c5c68",
  waveActive: "#8fb8e8",
  progress: "#3d3d47",
  progressActive: "#5f86b4",
  cursor: "#f2f2f4",
};

/**
 * Create one strip inside `parent`.
 *
 * @param {HTMLElement} parent
 * @param {object} opts
 * @param {string} opts.file        the recording's payload key
 * @param {number[]} opts.peaks     pregenerated, from the payload
 * @param {number} opts.duration    seconds, from the payload
 * @param {number} opts.height      CSS px
 * @param {number} opts.zoom        minPxPerSec; 0 fits the whole recording
 * @param {string} opts.label       language-neutral caption (conductor · year)
 * @param {(file: string, time: number) => void} opts.onSelect  tap handler
 * @param {object[]} [opts.sections] the ribbon's blocks in this recording's seconds
 * @param {Function} [opts.onNow]    see mountStrips
 * @returns {Strip}
 */
export function createStrip(parent, opts) {
  const colors = opts.colors || DEFAULT_COLORS;
  const el = document.createElement("div");
  el.className = "strip";
  el.dataset.file = opts.file;

  const host = document.createElement("div");
  host.className = "strip-ws";
  el.appendChild(host);

  // Overlaid rather than stacked above the waveform: vertical space is the scarce
  // dimension once a portrait screen is halved and then divided by eight, and an
  // overlay costs none of it. The caption is conductor and year — the two things
  // that need no translation, the same argument as the middle band (plan §6.3).
  const caption = document.createElement("span");
  caption.className = "strip-label";
  caption.textContent = opts.label;
  el.appendChild(caption);

  parent.appendChild(el);

  const regions = RegionsPlugin.create();
  const ws = WaveSurfer.create({
    container: host,
    height: opts.height,
    // 0 means fill the parent — the whole recording in the strip (config.js).
    minPxPerSec: opts.zoom || 0,
    waveColor: colors.wave,
    progressColor: colors.progress,
    cursorColor: colors.cursor,
    cursorWidth: 2,
    normalize: false,
    // Both off for the same reason listen.js turns them off: the exhibit owns
    // scroll position (per viewport, from week 2), and a renderer that scrolls
    // itself towards its own cursor fights whatever the visitor just did.
    autoScroll: false,
    autoCenter: false,
    // Off because WaveSurfer's own tap handling is transform-naive — see the
    // click listener below, which owns the tap→time mapping instead.
    interact: false,
    plugins: [regions],
    // The pair that makes this a peaks-only renderer. `duration` is the alignment
    // duration, which is also the timeline the grids and the peaks are in, so a
    // cursor position computed from a grid lands where the visitor sees it.
    peaks: [opts.peaks],
    duration: opts.duration,
  });

  // The tap→time mapping is OURS (`interact: false` above), because WaveSurfer's
  // is transform-naive: WS 7.12 computes the tapped position as `clientX −
  // boundingRect.left` over the wrapper's PAINTED box, and this exhibit paints
  // its strips through transforms — the far viewport is rotated 180° and
  // ?stageRotation turns the whole screen. Measured with real input events on
  // both engines (2026-08-24): a tap on the far half seeked to `duration − t`,
  // the playhead landing mirror-image from the finger, and under stageRotation
  // every tap collapsed to the visual x-axis regardless of where on the strip it
  // fell. `offsetX` is the coordinate the browser has already mapped back
  // through every ancestor transform, and shadow-DOM retargeting reports it
  // relative to WS's outer div — container-sized, NOT moved by the inner scroll
  // container, hence the explicit scroll term. In the unrotated case
  // (scroll + offsetX)/wrapperWidth reproduced WS's own mapping exactly, so the
  // one geometry that already worked is unchanged. This also keeps WaveSurfer
  // from seeking its own cursor on the tap, which the header note's one-clock
  // rule wanted anyway: the exhibit decides what a tap means, and the cursor
  // follows from the shared clock like every other cursor.
  host.addEventListener("click", (e) => {
    const width = ws.getWrapper().clientWidth;
    if (!width) return;
    const rel = (ws.getScroll() + e.offsetX) / width;
    opts.onSelect?.(opts.file, Math.max(0, Math.min(1, rel)) * opts.duration);
  });

  // WHY THIS PROMISE EXISTS, because it looks like ceremony over a renderer that
  // decodes nothing. WaveSurfer's constructor kicks off `load(url, peaks, duration)`
  // and does not await it, so `decodedData` — and therefore `getDuration()` — is
  // still absent when `create()` returns. The regions plugin clamps every region to
  // the duration it can see at the moment it is asked, so adding regions in the same
  // tick as the strip silently collapses all of them to 0→0, which WaveSurfer then
  // renders as a *marker* rather than a region: two-pixel slivers at the left edge,
  // no colour, and no error anywhere. Cost an hour to find; nothing about it is
  // visible from the code that added the regions.
  const ready = new Promise((resolve) => {
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      resolve(how);
    };
    ws.on("ready", () => finish("ready"));
    ws.on("error", (e) => {
      console.warn(`exhibit strip ${opts.file}: renderer error`, e);
      finish("error");
    });
    // A race, not an await: this is peaks in memory, so "ready" is a microtask
    // away — but boot must not be able to hang on an event that never arrives,
    // because what that looks like is "Loading…" left on a museum wall.
    setTimeout(() => {
      if (!settled) console.warn(`exhibit strip ${opts.file}: never signalled ready`);
      finish("timeout");
    }, 5000);
  });

  const ribbon = opts.sections?.length
    ? buildRibbon(ws.getWrapper(), opts.sections, opts.duration, opts.onNow)
    : null;
  let isActive = false;

  // "Now playing" bars (?activeStrip=bars; alpha-tester feedback 2026-09-10): a
  // three-bar equaliser glyph after the caption, shown on the active strip only
  // and animated only while the clock runs (exhibit.css keys it off #screen
  // [data-playing]). In the caption so it follows the text, pointer-events none
  // like the caption's.
  const live = document.createElement("span");
  live.className = "strip-live";
  live.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) live.appendChild(document.createElement("i"));
  caption.appendChild(live);

  const strip = {
    file: opts.file,
    el,
    host,
    caption,
    ws,
    regions,
    ready,
    duration: opts.duration,
    /** Put this strip's cursor at `time` in its OWN timeline. */
    setTime(time) {
      if (!Number.isFinite(time)) return;
      // WaveSurfer's setTime also writes `media.currentTime`, and the internal
      // <audio> element it made for us has no source. That is a no-op rather than
      // a throw in both engines, but a src-less media element is not a contract
      // anybody wrote down, so the guard stays.
      try {
        ws.setTime(time);
      } catch (_) {
        /* a src-less media element declining a seek costs us nothing */
      }
      // The ribbon names the theme playing now — on the audible strip only.
      if (isActive) ribbon?.setNow(time);
    },
    /** Mark this strip as the one the shared clock is running on. */
    setActive(active) {
      isActive = !!active;
      if (!isActive) ribbon?.clearNow();
      el.classList.toggle("is-active", !!active);
      ws.setOptions({
        waveColor: active ? colors.waveActive : colors.wave,
        progressColor: active ? colors.progressActive : colors.progress,
      });
    },
    /**
     * Mark this strip as THIS viewport's own last choice (turns.js). Distinct
     * from setActive on purpose: active is the screen's audible truth, selected
     * is one side's expressed desire — under the request policy they differ for
     * as long as the request is pending. A class only, no canvas repaint.
     */
    setSelected(on) {
      el.classList.toggle("is-selected", !!on);
    },
    destroy() {
      try {
        ws.destroy();
      } catch (_) {
        /* nothing to do about a renderer that is already gone */
      }
      el.remove();
    },
  };
  return strip;
}

/**
 * The section ribbon (?ribbon): the score's sections as blocks INSIDE the
 * renderer's scrolling wrapper, the layer WaveSurfer's own regions plugin uses.
 * That placement is the whole design: blocks are positioned in percent of the
 * recording, so zoom, scroll, and resize carry them with no redraw, and the
 * strip's box, its tap→time mapping, the glass, and the annotation regions
 * see exactly the strip they always saw. Measured 2026-11-10: a layer here
 * survives re-layout, and document CSS reaches it through `::part`, so
 * exhibit.css owns the look — the band's height, its place ABOVE the region
 * washes (the user, 2026-11-11: sharing the full height, the two could not be
 * told apart), and hiding the waveform under `.vp[data-look="ribbon"]`. Only
 * the blocks' horizontal geometry is inline.
 *
 * THEME NAMES without the mess (the user, 2026-11-17; measured: at museum
 * width a theme block's median is 34 px, too narrow for any name on all ten
 * strips). Two layers. A theme's SHORT name, shared by every section of a
 * recurring theme ("Waltz 1", "Cancan"), sits in its block only where it fits
 * — a container query per block hides it otherwise (exhibit.css) — so a
 * reader sees the same name come back. And the audible strip names the theme
 * playing NOW in full, one label pinned to that block's edge, moved only when
 * the music crosses into the next theme (setNow).
 *
 * @param {HTMLElement} wrapper   ws.getWrapper()
 * @param {object[]} sections     {id, level, label, short, start, end, color, odd}, seconds
 * @param {number} duration
 * @param {(now: {form: string|null, theme: string|null}) => void} [onNow]
 *   told whenever the audible strip crosses into another form or theme
 * @returns {{setNow: (t: number) => void, clearNow: () => void}}
 */
function buildRibbon(wrapper, sections, duration, onNow) {
  const at = (s) => (100 * Math.max(0, Math.min(duration, s))) / duration;
  const pct = (s) => `${at(s)}%`;
  const span = (s) =>
    `position:absolute;left:${pct(s.start)};width:calc(${pct(s.end)} - ${pct(s.start)})`;
  // Two layers with the same geometry: the BLOCKS, which may lie under the
  // annotation washes, and the NAMES, always above them like the cursor — a
  // wash over a name would hide exactly what it is meant to explain.
  const layer = document.createElement("div");
  layer.setAttribute("part", "ribbon");
  layer.style.cssText = "position:absolute;left:0;right:0;pointer-events:none";
  const names = document.createElement("div");
  names.setAttribute("part", "ribbon-names");
  names.style.cssText = layer.style.cssText;
  const themes = [];
  const forms = [];
  for (const s of sections) {
    const block = document.createElement("div");
    block.setAttribute("part", `section l${s.level}${s.odd ? " odd" : ""}`);
    block.dataset.section = s.id;
    block.style.cssText = span(s);
    block.style.setProperty("--section-color", s.color);
    layer.appendChild(block);
    (s.level === 2 ? themes : forms).push({ ...s, block });
    const text = s.level === 1 ? s.label : s.short;
    if (!text) continue;
    const box = document.createElement("div");
    box.setAttribute("part", `name-box l${s.level}`);
    box.style.cssText = span(s);
    const name = document.createElement("span");
    // A short name's width class picks the container query that hides it
    // where its box is narrower than the name (exhibit.css).
    const w = text.length <= 6 ? 1 : text.length <= 10 ? 2 : 3;
    name.setAttribute("part", s.level === 1 ? "section-label" : `short w${w}`);
    name.textContent = text;
    box.appendChild(name);
    names.appendChild(box);
  }
  const now = document.createElement("span");
  now.setAttribute("part", "now-label");
  names.appendChild(now);
  wrapper.prepend(layer, names);

  let current = null;
  const show = (theme) => {
    if (theme === current) return;
    current?.block.part.remove("now");
    current = theme;
    if (!theme) {
      now.part.remove("shown");
      return;
    }
    theme.block.part.add("now");
    now.textContent = theme.label;
    // From the block's left edge, unless that would run off the strip's end:
    // then from its right edge, leftwards.
    const late = at(theme.start) > 62;
    now.style.left = late ? "auto" : pct(theme.start);
    now.style.right = late ? `${100 - at(theme.end)}%` : "auto";
    now.part.add("shown");
  };
  // The form section playing now, for onNow: a form without themes of its
  // own (some of Kaiser-Walzer's) still names where the music is.
  let currentForm = null;
  // Set while this strip is not the audible one: its first frame back must
  // report even when nothing is playing there (before the first section),
  // or the viewport would keep the previous strip's names.
  let stale = true;
  const within = (list, t) => list.find((x) => t >= x.start && t < x.end) || null;
  return {
    setNow(t) {
      const inTheme = current && t >= current.start && t < current.end;
      const inForm = currentForm && t >= currentForm.start && t < currentForm.end;
      if (inTheme && inForm) return;
      const theme = within(themes, t);
      const form = within(forms, t);
      if (theme === current && form === currentForm && !stale) return;
      stale = false;
      show(theme);
      currentForm = form;
      onNow?.({ form: form?.label ?? null, theme: theme?.label ?? null });
    },
    // No onNow here: the strip that becomes audible reports on its next frame.
    clearNow: () => {
      show(null);
      currentForm = null;
      stale = true;
    },
  };
}

/**
 * One recording's sections in its OWN seconds, through its grid: a section's
 * `indexPair` names reference-grid indices, and every recording's grid maps
 * the same index to its own time. Only levels 1 (form) and 2 (themes) are
 * drawn — level 0 is the whole piece. Colours follow the form section, so a
 * theme reads as part of its form and the same section is the same colour on
 * every strip; `odd` alternates siblings so adjacent themes stay apart.
 */
function sectionsFor(sections, grid, palette, textFor) {
  if (!grid?.length || !palette?.length) return [];
  const at = (i) => grid[Math.max(0, Math.min(grid.length - 1, i))];
  const colorOf = new Map();
  const siblings = new Map();
  const out = [];
  for (const s of sections) {
    if (s.level !== 1 && s.level !== 2) continue;
    if (s.level === 1) colorOf.set(s.id, palette[colorOf.size % palette.length]);
    const n = siblings.get(s.parent) || 0;
    siblings.set(s.parent, n + 1);
    out.push({
      id: s.id,
      level: s.level,
      // Labels are language maps (prep); the xml:id stands in for a missing one.
      label: textFor(s.label) || s.id,
      short: textFor(s.short) || null,
      start: at(s.indexPair[0]),
      end: at(s.indexPair[1]),
      color: colorOf.get(s.level === 1 ? s.id : s.parent) || palette[0],
      odd: n % 2 === 1,
    });
  }
  return out;
}

/**
 * Build one viewport's full stack, in the payload's curated order.
 *
 * @param {HTMLElement} parent      the viewport's `.strips` container
 * @param {object} data             from payload.js
 * @param {object} config
 * @param {(file: string, time: number) => void} onSelect
 * @param {(file: string) => string} labelFor
 * @param {string[]} [sectionColors]  the ribbon's palette; omitted, no ribbon is built
 * @param {(value: object|string|null) => string} [textFor]  resolves a section
 *   label's language map in this viewport's language
 * @param {(now: {form: string|null, theme: string|null}) => void} [onNow]  told
 *   the form and theme playing now, by the audible strip, on change
 * @returns {{strips: Map<string, Strip>, ready: Promise<void>}} the map is keyed by
 *   recording, so the cursor loop and the region sync can both address a strip by
 *   the name the payload uses. `ready` settles once every renderer knows its own
 *   duration — nothing that measures a strip may run before it (see createStrip).
 */
export function mountStrips(
  parent,
  data,
  config,
  {
    onSelect,
    labelFor,
    colors,
    sectionColors,
    textFor = (v) => (typeof v === "string" ? v : ""),
    onNow,
  },
) {
  const strips = new Map();
  const files = data.order.slice(0, config.stackedRecordings);
  for (const file of files) {
    strips.set(
      file,
      createStrip(parent, {
        file,
        peaks: data.peaks[file],
        duration: data.durations[file],
        height: config.stripHeight,
        zoom: config.zoom,
        label: labelFor(file),
        onSelect,
        colors,
        sections:
          sectionColors && sectionsFor(data.sections, data.grids[file], sectionColors, textFor),
        onNow,
      }),
    );
  }
  const ready = Promise.all([...strips.values()].map((s) => s.ready)).then(() => {});
  return { strips, ready };
}

/**
 * @typedef {object} Strip
 * @property {string} file
 * @property {HTMLElement} el
 * @property {object} ws
 * @property {object} regions
 * @property {Promise<string>} ready
 * @property {number} duration
 * @property {(t: number) => void} setTime
 * @property {(active: boolean) => void} setActive
 * @property {() => void} destroy
 */
