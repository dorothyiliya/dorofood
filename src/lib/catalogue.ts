export type Category = "All" | "Snacks" | "Drinks" | "Pantry" | "Breakfast" | "Treats";

export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: Exclude<Category, "All">;
  size: string;
  priceKobo: number;
  compareAtKobo?: number;
  label?: string;
  description: string;
  emoji: string;
  packColor: string;
  background: string;
  origin: string;
  exportEligible: boolean;
};

export const categories: { name: Exclude<Category, "All">; count: string; emoji: string; background: string; color: string }[] = [
  { name: "Snacks", count: "Crunch time", emoji: "🥨", background: "#f3e3ce", color: "#bd7442" },
  { name: "Drinks", count: "Sip something good", emoji: "🥤", background: "#dce9e4", color: "#467d69" },
  { name: "Pantry", count: "Everyday essentials", emoji: "🫙", background: "#e8e6d1", color: "#7b8350" },
  { name: "Breakfast", count: "Better mornings", emoji: "🥣", background: "#f0deda", color: "#b56d5a" },
  { name: "Treats", count: "Little joys", emoji: "🍫", background: "#e8dfd5", color: "#735342" },
];

/** Sample presentation data for the store preview. Not real products, prices or stock. */
export const products: Product[] = [
  { id:"p-001", slug:"golden-plantain-crisps", name:"Golden Plantain Crisps", brand:"Dorocity Select", category:"Snacks", size:"150 g", priceKobo:185000, description:"Thin-cut, golden plantain crisps for the moments between meals.", emoji:"🍌", packColor:"#bd713c", background:"#f4e6d2", origin:"Nigeria", exportEligible:false },
  { id:"p-002", slug:"cocoa-cashew-bites", name:"Cocoa Cashew Bites", brand:"Little Indulgence", category:"Treats", size:"120 g", priceKobo:320000, description:"A rich, nutty snack made for a well-earned pause.", emoji:"🍫", packColor:"#604435", background:"#e9ded3", origin:"Nigeria", exportEligible:false },
  { id:"p-003", slug:"hibiscus-ginger-sparkler", name:"Hibiscus & Ginger Sparkler", brand:"Good Day Drinks", category:"Drinks", size:"330 ml · 4 pack", priceKobo:480000, description:"A bright, botanical drink with a gentle ginger finish.", emoji:"🌺", packColor:"#9b4149", background:"#f0dce0", origin:"Nigeria", exportEligible:false },
  { id:"p-004", slug:"morning-oats-and-seeds", name:"Morning Oats & Seeds", brand:"Everyday Ritual", category:"Breakfast", size:"500 g", priceKobo:425000, description:"A versatile breakfast base for slow mornings and busy starts.", emoji:"🌾", packColor:"#8e7545", background:"#e9e5d3", origin:"Nigeria", exportEligible:false },
  { id:"p-005", slug:"smoky-pepper-seasoning", name:"Smoky Pepper Seasoning", brand:"The Pantry Edit", category:"Pantry", size:"90 g", priceKobo:210000, description:"A warming blend to bring depth to everyday cooking.", emoji:"🌶️", packColor:"#a64f35", background:"#f0ded1", origin:"Nigeria", exportEligible:false },
  { id:"p-006", slug:"roasted-groundnut-crunch", name:"Roasted Groundnut Crunch", brand:"Dorocity Select", category:"Snacks", size:"200 g", priceKobo:160000, description:"A satisfying, savoury crunch for desks, road trips and sharing.", emoji:"🥜", packColor:"#b78343", background:"#eee2cb", origin:"Nigeria", exportEligible:false },
  { id:"p-007", slug:"citrus-black-tea", name:"Citrus Black Tea", brand:"Everyday Ritual", category:"Breakfast", size:"20 tea bags", priceKobo:390000, description:"A smooth black tea lifted with a fresh citrus note.", emoji:"🍵", packColor:"#496b50", background:"#dfe8d9", origin:"Nigeria", exportEligible:false },
  { id:"p-008", slug:"coconut-cocoa-granola", name:"Coconut Cocoa Granola", brand:"Morning People", category:"Breakfast", size:"350 g", priceKobo:560000, description:"Crunchy oats with coconut and a cocoa finish.", emoji:"🥥", packColor:"#68794f", background:"#e3e8d7", origin:"Nigeria", exportEligible:false },
];

export function formatNaira(amountKobo: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amountKobo / 100);
}
