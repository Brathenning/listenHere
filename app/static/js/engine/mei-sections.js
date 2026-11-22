/**
 * The MEI's <section>s, for correction mode's "Go to section" menu (UI note 4,
 * ruled 2026-11-11): each section is named by its @label, else its @xml:id,
 * else its measure range, and leads to the page of its first measure.
 *
 * A section that holds every measure of the score (a wrapper around the whole
 * piece) is left out: it would lead to page 1 and name nothing. Sections with
 * no measures are left out too. Nested sections keep their depth, so the menu
 * can indent them under their parent.
 */

const XML_NS = "http://www.w3.org/XML/1998/namespace";

function xmlId(el) {
  return el.getAttributeNS(XML_NS, "id") || el.getAttribute("xml:id") || "";
}

function byLocalName(root, name) {
  return [...root.getElementsByTagNameNS("*", name)];
}

/**
 * @param {string} meiText the MEI document
 * @returns {{ name: string, depth: number, firstMeasureId: string, lastMeasureId: string }[]} in
 *   document order; empty when the text does not parse or has no score.
 */
export function meiSections(meiText) {
  if (!meiText) return [];
  const doc = new DOMParser().parseFromString(meiText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  const score = byLocalName(doc, "score")[0];
  if (!score) return [];
  const total = byLocalName(score, "measure").length;
  const kept = new Map(); // section element → its entry
  const out = [];
  for (const s of byLocalName(score, "section")) {
    const measures = byLocalName(s, "measure");
    if (!measures.length || measures.length === total) continue;
    const first = measures[0];
    const last = measures[measures.length - 1];
    const firstMeasureId = xmlId(first);
    const lastMeasureId = xmlId(last);
    if (!firstMeasureId) continue; // nothing the layout can find
    let depth = 0;
    for (let p = s.parentElement; p && p !== score; p = p.parentElement) {
      if (kept.has(p)) depth++;
    }
    const n1 = first.getAttribute("n");
    const n2 = last.getAttribute("n");
    const range = n1 && n2 && n1 !== n2 ? `mm. ${n1}–${n2}` : n1 ? `m. ${n1}` : "";
    const name =
      (s.getAttribute("label") || "").trim() || xmlId(s) || range || `Section ${out.length + 1}`;
    const entry = { name, depth, firstMeasureId, lastMeasureId };
    kept.set(s, entry);
    out.push(entry);
  }
  return out;
}
