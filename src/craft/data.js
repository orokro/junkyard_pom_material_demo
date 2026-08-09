/**
 * ============================================================================
 * craft/data.js
 * ----------------------------------------------------------------------------
 * Item catalog + shapeless crafting recipes for the Dumper Cars crafting POC.
 *
 * Each item maps a game concept to a Blender node in parts_and_weapons_lite.glb
 * (names are the RAW Blender names; the loader strips dots to match three's
 * GLTFLoader sanitization). `mount` drives how it attaches to the car:
 *   - "front"/"back": fixed bumper slot, exact authored transform from the GLB.
 *   - "wheel": swaps one of the 4 wheel meshes (grip <-> slick).
 *   - "battery": battery-box slot.
 *   - "normal": raycast to the car's CarPaint surface, oriented to the normal.
 *   - "hand": hand-type item, attaches to a placed mount item's socket.
 *   - null: raw material / crafting input only, not mountable.
 * `group` lists every node that travels with the item (jointed weapons).
 * `socket` marks items that expose a hand-socket at their business end.
 * `outAxis` is the item-local axis that points OUT of the surface on normal mounts.
 * ============================================================================
 */

/** @typedef {"raw"|"part"|"wheel"|"battery"|"hand"|"weapon"} ItemCategory */

/** @type {Array<object>} */
export const ITEMS = [
	// ---- raw collectibles ----
	{ id: "long_pipe",   label: "Long Pipe",    node: "LongPipe",    cat: "part",   mount: "normal", socket: "tip", outAxis: "x", weight: 3 },
	{ id: "short_pipe",  label: "Short Pipe",   node: "ShortPipe",   cat: "part",   mount: "normal", socket: "tip", outAxis: "x", weight: 1 },
	{ id: "spring",      label: "Spring",       node: "Spring",      cat: "part",   mount: "normal", socket: "tip", outAxis: "x", weight: 1 },
	{ id: "scrap_iron",  label: "Scrap Iron",   node: "ScrapIron",   cat: "raw",    mount: null, weight: 2 },
	{ id: "scrap_copper",label: "Scrap Copper", node: "ScrapCopper", cat: "raw",    mount: null, weight: 2 },
	{ id: "rubber_hose", label: "Rubber Hose",  node: "RubberHose",  cat: "raw",    mount: null, weight: 1 },
	{ id: "hubcap",      label: "Hubcap",       node: "HubCap",      cat: "raw",    mount: null, weight: 2 },
	{ id: "gear",        label: "Gear",         node: "Gear",        cat: "raw",    mount: null, weight: 1 },
	{ id: "jerry_can",   label: "Jerry Can",    node: "JerryCan",    cat: "raw",    mount: null, weight: 2 },
	{ id: "soda_can",    label: "Soda Can",     node: "SodaCan",     cat: "raw",    mount: null, weight: 1 },
	{ id: "saw_blade",   label: "Saw Blade",    node: "SawBlade",    cat: "part",   mount: null, weight: 1 },
	{ id: "copper_coil", label: "Copper Coil",  node: "CopperCoil",  cat: "part",   mount: null, weight: 1 },

	// ---- wheels ----
	{ id: "grip_tire",   label: "Grip Tire",    node: "GripTire",    cat: "wheel",  mount: "wheel", weight: 0 },
	{ id: "slick_tire",  label: "Slick Tire",   node: "SlickTire",   cat: "wheel",  mount: "wheel", weight: 0 },

	// ---- battery ----
	{ id: "battery",     label: "Battery",      node: "Battery",     cat: "battery",mount: "battery", weight: 4 },

	// ---- hand-types (mirror on -X side; kancho excluded) ----
	{ id: "slap_hand",   label: "Slap Hand",    node: "SlapHand",    cat: "hand",   mount: "hand", hand: true, weight: 1 },
	{ id: "fist",        label: "Fist",         node: "Fist",        cat: "hand",   mount: "hand", hand: true, weight: 1 },

	// ---- armor (free-placeable) ----
	{ id: "iron_plate",  label: "Iron Plate",   node: "IronPlate",   cat: "weapon", mount: "place", outAxis: "y", weight: 3 },
	{ id: "copper_plate",label: "Copper Plate", node: "CopperPlate", cat: "weapon", mount: "place", outAxis: "y", weight: 2 },

	// ---- hydraulics (normal mount, hand socket) ----
	{ id: "hyd_piston",  label: "Hydraulic Piston", node: "HydraulicPiston", cat: "weapon", mount: "normal", outAxis: "x", weight: 3,
	  socket: "ram", group: ["HydraulicPiston", "HydraulicPiston.001"] },
	{ id: "hyd_arm",     label: "Hydraulic Arm", node: "HydraulicArm", cat: "weapon", mount: "normal", outAxis: "x", weight: 3,
	  socket: "elbow", group: ["HydraulicArm", "HydraulicArmArm", "HydraulicArmPiston", "HydraulicArmPistonArm"] },

	// ---- fixed-slot weapons ----
	{ id: "electromagnet", label: "Electromagnet", node: "ElectroMagnet", cat: "weapon", mount: "front", weight: 3 },
	{ id: "emp_gun",       label: "EMP Wave Gun",  node: "EMPGun",        cat: "weapon", mount: "front", weight: 3 },
	{ id: "chest_spikes",  label: "Chest Spikes",  node: "ChestSpikes",   cat: "weapon", mount: "front", weight: 3 },
	{ id: "kancho",        label: "Kancho Prod",   node: "KanchoProd",    cat: "weapon", mount: "front", weight: 4 },
	{ id: "jet_thruster",  label: "Jet Thruster",  node: "JetThruster",   cat: "weapon", mount: "back",  weight: 4 },
	{ id: "scorpion_tail", label: "Scorpion Tail", node: "ScorpoinTailBase", cat: "weapon", mount: "back", weight: 4, socket: "tail",
	  group: ["ScorpoinTailBase","ScorpionTailPivot","PistonPair","PistonPairArms","ScorpionTailRoot",
	          "ScorpionTailSegment_1","ScorpionTailSegment_2","ScorpionTailSegment_3","ScorpionTailSegment_4","ScorpionTailSegment_5","ScorpionTailSegment_6"] },

	// ---- free-placeable weapons (raycast onto CarPaint, oriented to the normal) ----
	// outSign flips which end of outAxis points OUT of the surface (geometry authored inward).
	{ id: "launcher",  label: "Launcher", node: "Launcher", cat: "weapon", mount: "place", outAxis: "x", outSign: -1, upBias: 0.4, placeScale: 0.5, weight: 3 },
	{ id: "side_saw",  label: "Side-Saw", node: "SideSaw",  cat: "weapon", mount: "place", outAxis: "x", outSign: -1, weight: 3, group: ["SideSaw", "SideSawBlade"] },
];

/**
 * ---- composite weapons: a HAND welded onto a BASE ------------------------
 * Per Greg's many-to-many rule: any base (pipe/spring/hydraulic) can take any
 * hand (slap/fist/kancho). Each combo is a single craftable, free-placeable
 * item. `composite` carries the pieces + which hand-socket transform to use;
 * library.bakeComposite() assembles the geometry. The base's own +X points out
 * of the car surface, so the hand ends up at the business end.
 */
const COMBO_BASES = [
	{ id: "short_pipe", label: "Short Pipe", type: "default" },
	{ id: "long_pipe",  label: "Long Pipe",  type: "default" },
	{ id: "spring",     label: "Spring",     type: "default" },
	{ id: "hyd_piston", label: "Hyd Piston", type: "default" },
	{ id: "hyd_arm",    label: "Hyd Arm",    type: "elbow" },   // fist/slap socket variants
];
const COMBO_HANDS = [
	{ id: "slap_hand", label: "Slap" },
	{ id: "fist",      label: "Fist" },
	{ id: "kancho",    label: "Kancho" },
];
const _byIdInit = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
/** @type {Array<object>} */
export const COMPOSITES = [];
for (const b of COMBO_BASES) {
	for (const h of COMBO_HANDS) {
		// elbow bases have distinct fist/slap socket transforms; kancho reuses slap.
		const socket = b.type === "elbow" ? (h.id === "fist" ? "fist" : "slap") : "default";
		COMPOSITES.push({
			id: `${b.id}__${h.id}`,
			label: `${b.label} ${h.label}`,
			node: _byIdInit[b.id].node,
			cat: "weapon",
			mount: "place",
			outAxis: "x",
			weight: (_byIdInit[b.id]?.weight || 0) + (_byIdInit[h.id]?.weight || 0),
			composite: { base: b.id, hand: h.id, socket },
		});
	}
}
ITEMS.push(...COMPOSITES);

/**
 * ---- scorpion tail composites: hand on the tail tip -> REAR slot -----------
 * Unlike the free-placeable composites above, ScorpionTail × hand is an
 * AUTO-SLOT weapon (rear bumper) per the UI spec — crafted from the tail base +
 * a hand, attached at the tail's authored rear transform with the hand posed at
 * the tail tip socket.
 */
export const SCORPION_COMPOSITES = COMBO_HANDS.map((h) => ({
	id: `scorpion_tail__${h.id}`,
	label: `Scorpion ${h.label}`,
	node: _byIdInit.scorpion_tail.node,
	cat: "weapon",
	mount: "back",
	weight: (_byIdInit.scorpion_tail?.weight || 0) + (_byIdInit[h.id]?.weight || 0),
	composite: { base: "scorpion_tail", hand: h.id, socket: "default" },
}));
ITEMS.push(...SCORPION_COMPOSITES);

/** Demo/example nodes we must never bake into another item's geometry. */
export const DEMO_NODES = ["Fist", "Fist.001", "Fist.002", "SlapHand", "SlapHand.001", "SlapHand.003", "Rocket"];

/** id -> item, for quick lookup. */
export const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/**
 * Shapeless recipes. `in` is an exact multiset of item ids -> counts that must
 * match the crafting grid. `out` is the list of ALTERNATIVE outputs — grabbing
 * one consumes the inputs (many-to-many, per Greg's rule).
 * @type {Array<{in: Record<string, number>, out: string[]}>}
 */
export const RECIPES = [
	{ in: { long_pipe: 1 }, out: ["short_pipe", "short_pipe", "short_pipe"] },   // shown as 3x short pipe
	{ in: { short_pipe: 3 }, out: ["long_pipe"] },
	{ in: { short_pipe: 2 }, out: ["scrap_iron"] },
	{ in: { scrap_iron: 1 }, out: ["spring", "iron_plate"] },                    // grab either
	{ in: { scrap_copper: 1 }, out: ["copper_coil", "copper_plate"] },
	{ in: { rubber_hose: 1, short_pipe: 5 }, out: ["slap_hand", "fist"] },       // the "Hand", many-to-many
	{ in: { slap_hand: 1 }, out: ["fist"] },                                     // optional conversion
	{ in: { fist: 1 }, out: ["slap_hand"] },
	{ in: { slap_hand: 2 }, out: ["kancho"] },                                   // kancho = 2 slap hands
	{ in: { hubcap: 1, scrap_iron: 1 }, out: ["saw_blade"] },
	{ in: { grip_tire: 1, rubber_hose: 1 }, out: ["slick_tire"] },
	{ in: { short_pipe: 2 }, out: ["hyd_piston"] },                             // hydraulic cylinder
	{ in: { gear: 1, copper_coil: 1, scrap_iron: 1 }, out: ["electromagnet", "emp_gun"] },
	{ in: { iron_plate: 1, short_pipe: 1 }, out: ["chest_spikes"] },
	{ in: { saw_blade: 1, gear: 1, short_pipe: 1 }, out: ["side_saw"] },
	{ in: { short_pipe: 2, spring: 1, gear: 1 }, out: ["launcher"] },
	{ in: { long_pipe: 1, gear: 1 }, out: ["jet_thruster"] },
	{ in: { jerry_can: 1, scrap_iron: 1, scrap_copper: 1 }, out: ["battery"] },
	{ in: { short_pipe: 2, hyd_piston: 1, rubber_hose: 1 }, out: ["scorpion_tail"] }, // 2 pipe + hyd cyl + hose
];

// composite recipes: base + hand -> the welded weapon (base×hand, many-to-many).
for (const c of [...COMPOSITES, ...SCORPION_COMPOSITES]) {
	RECIPES.push({ in: { [c.composite.base]: 1, [c.composite.hand]: 1 }, out: [c.id] });
}
