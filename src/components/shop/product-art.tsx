import { BowlSteam, Cake, Cookie, Drop, Grains, Jar, Basket, Pepper } from "@phosphor-icons/react/dist/ssr";
import type { CategoryIcon, Product } from "@/lib/catalogue";

const GLYPHS = { snacks: Cookie, drinks: Drop, pantry: Jar, breakfast: BowlSteam, treats: Cake, spices: Pepper, grains: Grains, other: Basket } as const;

export function CategoryGlyph({ icon, size = 24, className }: { icon: CategoryIcon; size?: number; className?: string }) {
  const Glyph = GLYPHS[icon] ?? Basket;
  return <Glyph size={size} weight="duotone" className={className} aria-hidden="true" />;
}

/**
 * Product photo when one has been uploaded; otherwise an illustrated pack in a
 * stable brand colourway, so the shop looks deliberate before photography exists.
 */
export function ProductArt({ product, size = "card", priority = false }: { product: Product; size?: "card" | "shelf" | "page" | "thumb"; priority?: boolean }) {
  const image = product.images[0];
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element -- staff-supplied URLs from any https host; next/image would need an open remotePatterns list
    return <img src={image.url} alt={image.alt || product.name} loading={priority ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />;
  }
  const scale = { thumb: "w-[46%] rounded-md p-1.5", card: "w-[54%] rounded-xl p-3", shelf: "w-full rounded-2xl p-4", page: "w-[50%] rounded-2xl p-5" }[size];
  const nameSize = { thumb: "text-[6px]", card: "text-[11px]", shelf: "text-[13px] sm:text-base", page: "text-base" }[size];
  return (
    <div className="grid h-full w-full place-items-center" role="img" aria-label={`${product.name}, ${product.size}`}>
      <div className={`relative flex aspect-[3/4] flex-col items-center justify-between text-center ${size === "shelf" ? "shadow-float" : "shadow-lift"} ${scale}`} style={{ background: product.pack.color, color: product.pack.ink }}>
        <span className="absolute inset-x-0 top-0 h-[7%] rounded-t-[inherit] bg-black/10" aria-hidden="true" />
        <span className={`mt-[10%] font-display font-semibold uppercase leading-tight tracking-wide ${size === "thumb" ? "hidden" : "text-[9px]"}`}>{product.brand}</span>
        <CategoryGlyph icon={product.icon} size={size === "thumb" ? 14 : size === "card" ? 30 : 48} className="opacity-90" />
        <span className={`mb-[6%] font-display font-bold uppercase leading-tight ${nameSize}`}>{product.name}</span>
      </div>
    </div>
  );
}
