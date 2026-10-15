/**
 * Storefront product shape, plus presentation fallbacks used until real
 * product photography is uploaded in the admin.
 */

export type ProductImage = { url: string; alt: string };

export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  categorySlug: string;
  size: string;
  priceKobo: number;
  compareAtKobo?: number;
  description: string;
  images: ProductImage[];
  /** Illustrated pack colours, used when there is no photo. */
  pack: { color: string; ink: string };
  icon: CategoryIcon;
  origin: string;
  /** Market codes this product can be delivered to. */
  shipsTo: string[];
  available: boolean;
  addedAt: string;
};

export type CategoryIcon = "snacks" | "drinks" | "pantry" | "breakfast" | "treats" | "spices" | "grains" | "other";

export type CategorySummary = { name: string; slug: string; icon: CategoryIcon; count: number };

/** Packaging colourways that sit well beside the logo greens and gold. */
const COLOURWAYS = [
  { color: "#123c2a", ink: "#f1f7ec" }, // deep forest
  { color: "#457512", ink: "#f8fbf2" }, // leaf
  { color: "#e4ba0c", ink: "#2a2200" }, // harvest gold
  { color: "#a8432a", ink: "#fff3ec" }, // pepper red
  { color: "#5a3b2b", ink: "#f6ece4" }, // cocoa
  { color: "#2f6b5e", ink: "#eaf6f2" }, // teal leaf
  { color: "#8e2f4b", ink: "#fbecf1" }, // hibiscus
];

const ICONS: Record<string, CategoryIcon> = {
  snacks: "snacks", snack: "snacks", drinks: "drinks", beverages: "drinks", pantry: "pantry",
  breakfast: "breakfast", treats: "treats", sweets: "treats", spices: "spices", seasoning: "spices", grains: "grains", flour: "grains",
};

export function categoryIcon(categoryName: string): CategoryIcon {
  return ICONS[categoryName.trim().toLowerCase()] ?? "other";
}

function hash(value: string) {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Colourway by catalogue position, so neighbouring products never share a
 * colour; falls back to a hash of the slug when there is no position.
 */
export function packFor(slug: string, position?: number) {
  return COLOURWAYS[(position ?? hash(slug)) % COLOURWAYS.length];
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function formatNaira(amountKobo: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amountKobo / 100);
}

type Sample = Omit<Product, "pack" | "icon" | "categorySlug" | "images" | "shipsTo" | "available" | "addedAt" | "origin">;

const SAMPLES: Sample[] = [
  { id: "p-001", slug: "golden-plantain-crisps", name: "Golden Plantain Crisps", brand: "Dorocity Select", category: "Snacks", size: "150 g", priceKobo: 185000, description: "Thin-cut, golden plantain crisps for the moments between meals." },
  { id: "p-002", slug: "cocoa-cashew-bites", name: "Cocoa Cashew Bites", brand: "Little Indulgence", category: "Treats", size: "120 g", priceKobo: 320000, description: "Roasted cashews in a dark cocoa coating." },
  { id: "p-003", slug: "hibiscus-ginger-sparkler", name: "Hibiscus & Ginger Sparkler", brand: "Good Day Drinks", category: "Drinks", size: "330 ml, 4 pack", priceKobo: 480000, description: "A bright zobo-style sparkling drink with a gentle ginger finish." },
  { id: "p-004", slug: "morning-oats-and-seeds", name: "Morning Oats & Seeds", brand: "Everyday Ritual", category: "Breakfast", size: "500 g", priceKobo: 425000, description: "Rolled oats with pumpkin and sunflower seeds." },
  { id: "p-005", slug: "smoky-pepper-seasoning", name: "Smoky Pepper Seasoning", brand: "The Pantry Edit", category: "Pantry", size: "90 g", priceKobo: 210000, description: "Dried pepper, onion and spices for stews and grills." },
  { id: "p-006", slug: "roasted-groundnut-crunch", name: "Roasted Groundnut Crunch", brand: "Dorocity Select", category: "Snacks", size: "200 g", priceKobo: 160000, description: "Salted roasted groundnuts with a crisp coating." },
  { id: "p-007", slug: "citrus-black-tea", name: "Citrus Black Tea", brand: "Everyday Ritual", category: "Breakfast", size: "20 tea bags", priceKobo: 390000, description: "Black tea with dried orange peel." },
  { id: "p-008", slug: "coconut-cocoa-granola", name: "Coconut Cocoa Granola", brand: "Morning People", category: "Breakfast", size: "350 g", priceKobo: 560000, description: "Baked oat clusters with coconut and cocoa." },
];

/** Sample catalogue for the store preview. Not real products, prices or stock. */
export const sampleProducts: Product[] = SAMPLES.map((p, i) => ({
  ...p,
  categorySlug: slugify(p.category),
  images: [],
  pack: packFor(p.slug, i),
  icon: categoryIcon(p.category),
  origin: "NG",
  shipsTo: ["NG"],
  available: true,
  addedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
}));

export function summariseCategories(products: Product[], order: string[] = []): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const p of products) {
    const existing = map.get(p.categorySlug);
    if (existing) existing.count++;
    else map.set(p.categorySlug, { name: p.category, slug: p.categorySlug, icon: p.icon, count: 1 });
  }
  const rank = (name: string) => (order.indexOf(name) === -1 ? Number.MAX_SAFE_INTEGER : order.indexOf(name));
  return [...map.values()].sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name));
}
