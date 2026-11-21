(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const els = Array.from(document.querySelectorAll("[data-paprika-id]"));
  for (const el of els) el.style.transform = "none";
  const boxes = {};
  const lines = {};
  for (const el of els) {
    if (!el.getClientRects().length) continue;
    const id = el.getAttribute("data-paprika-id");
    const b = el.getBoundingClientRect();
    boxes[id] = [r2(b.left + scrollX), r2(b.top + scrollY), r2(b.width), r2(b.height)];
    const type = el.getAttribute("data-paprika-type");
    const host = type === "text" ? el : type === "shape" ? el.lastElementChild : null;
    if (!host) continue;
    const node = host.firstChild;
    if (!node || node.nodeType !== 3 || node.data.length > 5000) continue;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    host.insertBefore(probe, node);
    const base = probe.getBoundingClientRect().bottom;
    host.removeChild(probe);
    const range = document.createRange();
    const out = [];
    let cur = null;
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i];
      if (ch === "\n") { cur = null; continue; }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rs = range.getClientRects();
      if (!rs.length) continue;
      const r = rs[rs.length - 1];
      if (!cur || Math.abs(r.top - cur.top) > 1) { cur = { t: "", x: r.left, top: r.top }; out.push(cur); }
      cur.t += ch;
    }
    if (!out.length) continue;
    const offset = base - out[0].top;
    lines[id] = out
      .map((l) => ({ t: l.t.replace(/ +$/, ""), x: r2(l.x - b.left), y: r2(l.top + offset - b.top) }))
      .filter((l) => l.t);
  }
  return { boxes, lines };
})()
