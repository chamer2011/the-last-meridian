// A small drawing of each item for the inventory's grid, in console art, made to fit the squares the item takes. Each
// item's own drawing is in its file under world/items (its Drawing part), and comes to the page with the item; an item
// without one gets one for its kind.

const KIND = { weapon: ["=[#]=-"], armor: ["/\\_/\\", "|[ ]|"], consumable: ["[+]"], gadget: ["[*]"], story: ["<*>"] };

export const artFor = (item) => (item?.art?.length ? item.art : KIND[item?.type] ?? ["[?]"]);
