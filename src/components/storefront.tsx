"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, Check, Minus, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, Truck, X } from "lucide-react";
import { categories, formatNaira, products, type Category, type Product } from "@/lib/catalogue";

type CartItem = { product: Product; quantity: number };

/** Mirrors the server-side per-product limit. */
const MAX_QUANTITY = 50;
const MARKETS = ["Nigeria", "United Kingdom", "United States", "Canada", "Other destinations"] as const;
type Market = (typeof MARKETS)[number];

/** Every product is currently Nigerian-origin; anything else needs export eligibility. */
function canShipTo(product: Product, market: Market) {
  return market === "Nigeria" || product.exportEligible;
}

function ProductPack({ product }: { product: Product }) {
  return (
    <div className="product-visual" style={{ background: product.background }}>
      {product.label && <span className="product-tag">{product.label}</span>}
      <div className="product-pack" style={{ background: product.packColor }}>
        <div className="pack-brand">{product.brand.toUpperCase()}</div>
        <div className="pack-icon" aria-hidden="true">{product.emoji}</div>
        <div className="pack-label">{product.name.toUpperCase()}</div>
      </div>
    </div>
  );
}

export default function Storefront() {
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [market, setMarket] = useState<Market>("Nigeria");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!cartOpen) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCartOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cartOpen]);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const categoryMatch = activeCategory === "All" || product.category === activeCategory;
    const searchMatch = `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase().includes(query.toLowerCase());
    return categoryMatch && searchMatch;
  }), [activeCategory, query]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.product.priceKobo * item.quantity, 0);

  function addToCart(product: Product) {
    if (!canShipTo(product, market)) {
      setToast(`${product.name} is not available for delivery to ${market}.`);
      return;
    }
    setCart((current) => {
      const found = current.find((item) => item.product.id === product.id);
      if (found) return current.map((item) => item.product.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, MAX_QUANTITY) } : item);
      return [...current, { product, quantity: 1 }];
    });
    setToast(`${product.name} added to your bag`);
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((current) => current.flatMap((item) => {
      if (item.product.id !== productId) return [item];
      const quantity = item.quantity + delta;
      return quantity <= 0 ? [] : [{ ...item, quantity: Math.min(quantity, MAX_QUANTITY) }];
    }));
  }

  function scrollToShop() {
    document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main className="site-shell">
      <div className="announcement">
        <Sparkles size={13} /> STORE PREVIEW <span aria-hidden="true">·</span> <span>SAMPLE PRODUCTS AND PRICES · ORDERING IS NOT OPEN YET</span>
      </div>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Dorocity Food home">
          <span className="brand-mark">d.</span>
          <span className="brand-name">dorocity food<span>THE GOOD FOOD EDIT</span></span>
        </a>
        <nav className="navlinks" aria-label="Main navigation">
          <a href="#shop">Shop all</a>
          <a href="#collections">Collections</a>
          <a href="#food-boxes">Food boxes</a>
          <a href="#story">Our story</a>
        </nav>
        <div className="top-actions">
          <label className="market-picker" style={{ display:"flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700 }}>
            <span className="sr-only">Shopping market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value as Market)} aria-label="Shopping market" style={{ border:0, background:"transparent", maxWidth:95, color:"inherit", fontSize:11, fontWeight:700, outlineOffset:3 }}>
              {MARKETS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <button className="icon-button" onClick={() => setCartOpen(true)} aria-label={`Open shopping bag, ${cartCount} items`}>
            <ShoppingBag size={18}/><span className="bag-count">{cartCount}</span>
          </button>
        </div>
      </header>

      {market !== "Nigeria" && (
        <div role="status" style={{ background: "#fbefe6", color: "#7a3d1c", fontSize: 12, fontWeight: 600, textAlign: "center", padding: "10px 16px" }}>
          We do not deliver to {market === "Other destinations" ? "destinations outside Nigeria" : market} yet. Products shown are for delivery within Nigeria only, priced in naira.
        </div>
      )}

      <section className="hero-wrap">
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot"/> THE GOOD FOOD EDIT</div>
            <h1>Good food finds.<br/><em>Made for your</em><br/>everyday.</h1>
            <p>From little treats to pantry favourites, discover a thoughtful mix of good things to eat, sip, share and keep close.</p>
            <div className="hero-buttons">
              <button className="button-primary" onClick={scrollToShop}>Explore the shop <ArrowRight size={15}/></button>
              <a className="button-secondary" href="#food-boxes">Meet the food boxes <ArrowDownRight size={15}/></a>
            </div>
          </div>
          <div className="hero-art" role="img" aria-label="Illustration of a curated Dorocity Food box">
            <div className="art-sun"/>
            <div className="art-blob"/>
            <div className="food-box">
              <div className="box-logo">dorocity.</div>
              <div className="box-sub">THE GOOD FOOD EDIT</div>
              <div className="food-items"><span/><span/><span/></div>
            </div>
            <div className="floating-note"><span><Check size={14}/></span> A little something good, inside.</div>
          </div>
        </div>
      </section>

      <section className="section" id="collections">
        <div className="section-head">
          <div><div className="section-kicker">Find your kind of good</div><h2>A good place to start.</h2></div>
          <p className="section-description">Your pantry, your rituals, your little everyday joys. Find what you came for — and maybe something new.</p>
        </div>
        <div className="category-grid">
          {categories.map((category) => (
            <button key={category.name} className="category-card" onClick={() => { setActiveCategory(category.name); scrollToShop(); }}>
              <div className="category-art" style={{ background: category.background }}>
                <div className="shape" style={{ background: category.color }}>{category.emoji}</div>
              </div>
              <div className="category-name">{category.name}<ArrowRight size={14}/></div>
              <div className="category-count">{category.count}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="section product-section" id="shop">
        <div className="section-head">
          <div><div className="section-kicker">Picked with a little more care</div><h2>Meet the good stuff.</h2></div>
          <a className="text-link" href="#shop" onClick={(e) => { e.preventDefault(); setActiveCategory("All"); setQuery(""); }}>View all products <ArrowRight size={14}/></a>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:15, flexWrap:"wrap", marginBottom:19 }}>
          <div className="filter-row" style={{ marginBottom:0 }}>
            {(["All", "Snacks", "Drinks", "Pantry", "Breakfast", "Treats"] as Category[]).map((category) => (
              <button key={category} className={`filter-chip ${activeCategory === category ? "active" : ""}`} onClick={() => setActiveCategory(category)}>{category}</button>
            ))}
          </div>
          <label style={{ display:"flex", alignItems:"center", gap:8, borderBottom:"1px solid #c9cec4", padding:"8px 0", minWidth:190 }}>
            <Search size={15} color="#68736a"/>
            <input aria-label="Search products" placeholder="Find something good..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ border:0, outline:0, background:"transparent", fontSize:11, width:"100%" }}/>
          </label>
        </div>
        <div className="product-grid">
          {visibleProducts.map((product) => (
            <article key={product.id} className="product-card">
              <ProductPack product={product}/>
              <div className="product-info">
                <div className="product-brand">{product.brand}</div>
                <h3 className="product-title">{product.name}</h3>
                <div className="product-meta">{product.size} · {product.category}</div>
                <div className="product-bottom">
                  <span className="product-price">{formatNaira(product.priceKobo)}</span>
                  {canShipTo(product, market)
                    ? <button className="add-button" aria-label={`Add ${product.name} to bag`} onClick={() => addToCart(product)}><Plus size={17}/></button>
                    : <span style={{ fontSize: 10, color: "#68736a", maxWidth: 90, textAlign: "right" }}>Nigeria delivery only</span>}
                </div>
              </div>
            </article>
          ))}
          {visibleProducts.length === 0 && <div className="product-empty">No matches just yet. Try another search or browse all products.</div>}
        </div>
      </section>

      <section className="promo-strip" id="food-boxes">
        <div>
          <div className="section-kicker">Good things, gathered</div>
          <h3>Your next favourite might come in a box.</h3>
          <p>Snack breaks, pantry restocks, thoughtful gifts — we are bringing good things together, one considered collection at a time.</p>
          <p style={{ marginTop:19, fontWeight:700 }}>Food boxes are coming soon.</p>
        </div>
        <div className="promo-stamp">CURATED<br/>WITH CARE<br/>✳ DOROCITY</div>
      </section>

      <section className="section" id="story">
        <div className="section-head">
          <div><div className="section-kicker">A little more intention</div><h2>Good food should<br/>feel good, too.</h2></div>
          <p className="section-description">We believe shopping for the everyday should be a little less overwhelming and a lot more thoughtful. So we bring good finds into one considered place.</p>
        </div>
        <div className="values-grid">
          <div className="value-card"><div className="value-icon"><Sparkles size={18}/></div><h3>Thoughtfully selected</h3><p>A considered mix of familiar favourites and new discoveries, organised to make finding your next good thing feel easy.</p></div>
          <div className="value-card"><div className="value-icon"><ShieldCheck size={18}/></div><h3>Clarity at every step</h3><p>Clear product details, transparent pricing and delivery information you can understand before you place an order.</p></div>
          <div className="value-card"><div className="value-icon"><Truck size={18}/></div><h3>Care from shelf to door</h3><p>We are building a more considered shopping experience, with careful handling and dependable fulfilment at its heart.</p></div>
        </div>
      </section>

      <section className="newsletter">
        <div><div className="section-kicker" style={{ color:"#e9a17c" }}>A good thing in your inbox</div><h2>Stay in the good loop.</h2><p>New finds, thoughtful collections, and a little inspiration for your pantry. No noise, just the good stuff.</p></div>
        <p style={{ alignSelf:"center", fontWeight:700 }}>Newsletter sign-up opens at launch.</p>
      </section>

      <footer className="footer">
        <a className="brand" href="#" aria-label="Dorocity Food home"><span className="brand-mark">d.</span><span className="brand-name">dorocity food<span>THE GOOD FOOD EDIT</span></span></a>
        <div className="footer-note">© {new Date().getFullYear()} Dorocity Food. Good things, thoughtfully found.</div>
        <div className="footer-links"><a href="#story">Our story</a><a href="#shop">Shop</a><a href="mailto:hello@dorocityfoods.com">Contact</a></div>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}

      {cartOpen && <div className="cart-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}>
        <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Your shopping bag">
          <div className="cart-head"><h2>Your good things <span style={{ color:"#68736a", fontSize:14 }}>({cartCount})</span></h2><button ref={closeButton} className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close bag"><X size={20}/></button></div>
          <div className="cart-lines">
            {cart.length === 0 ? <div style={{ textAlign:"center", padding:"55px 12px" }}><ShoppingBag size={28} style={{ margin:"0 auto 14px" }}/><h3 style={{ fontFamily:"Manrope", fontSize:18 }}>Your bag is taking a breather.</h3><p style={{ color:"#68736a", fontSize:12, lineHeight:1.7 }}>Find a few good things to bring it to life.</p><button className="button-primary" onClick={() => { setCartOpen(false); scrollToShop(); }}>Explore the shop</button></div> :
              cart.map((item) => <div className="cart-line" key={item.product.id}>
                <div className="cart-thumb" style={{ background:item.product.background }}>{item.product.emoji}</div>
                <div className="cart-line-main"><div className="cart-line-title">{item.product.name}</div><div className="cart-line-price">{formatNaira(item.product.priceKobo)} · {item.product.size}</div>
                  <div className="quantity-controls"><button onClick={() => changeQuantity(item.product.id,-1)} aria-label="Decrease quantity"><Minus size={12}/></button><span style={{ fontSize:11 }}>{item.quantity}</span><button onClick={() => changeQuantity(item.product.id,1)} aria-label="Increase quantity"><Plus size={12}/></button></div>
                </div>
                <strong style={{ fontSize:12 }}>{formatNaira(item.product.priceKobo * item.quantity)}</strong>
              </div>)
            }
          </div>
          {cart.length > 0 && <div className="cart-summary"><div className="cart-total"><span>Subtotal</span><span>{formatNaira(subtotal)}</span></div><button className="button-primary" style={{ width:"100%", opacity:0.55, cursor:"not-allowed" }} disabled aria-disabled="true">Checkout is not open yet</button><div className="cart-disclaimer">This is a store preview with sample products and prices. It does not take payments or create orders, and your bag is not saved.</div></div>}
        </aside>
      </div>}
    </main>
  );
}
