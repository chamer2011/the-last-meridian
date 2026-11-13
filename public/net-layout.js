// Where each system sits on a network map (step 7 of the hacking rework). Each deck is a band, top to bottom; in each,
// the systems keep their order from fore to aft, spread across the band, and a crowded deck is staggered over as many
// rows as keep any two boxes on one row apart. A box is at most `box` wide and `boxHeight` tall (the stylesheet caps a
// name at two lines), and rows are `row` apart, so nothing on the map sits on anything else. The page draws with it, and
// the tests check it.

export const NET_MAP = { width: 440, box: 100, boxHeight: 36, gap: 6, row: 40, head: 16, foot: 4, between: 8 };

export function layOutNetMap(map, width = NET_MAP.width) {
  const { box, gap, row, head, foot, between } = NET_MAP;
  // The middle of a box can go anywhere from half a box in from the left to half a box in from the right.
  const room = Math.max(0, width - box);
  const bands = [];
  const at = {};
  let y = 0;
  for (const band of map.bands) {
    const list = map.nodes.filter((node) => node.band === band.id).sort((a, b) => a.i - b.i);
    const step = list.length > 1 ? room / (list.length - 1) : 0;
    const rows = step > 0 ? Math.max(1, Math.ceil((box + gap) / step)) : 1;
    const height = head + rows * row + foot;
    list.forEach((node, i) => {
      at[node.id] = { x: Math.round(list.length > 1 ? box / 2 + i * step : width / 2), y: Math.round(y + head + (i % rows) * row + row / 2) };
    });
    bands.push({ ...band, y, height, rows });
    y += height + between;
  }
  return { width, height: Math.max(0, y - between), bands, at };
}
