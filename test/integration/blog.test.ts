import { describe, expect, it } from "vitest";
import { deletePostForever, restorePost, restoreRevision, saveBlogCategory, savePost, saveRedirect, trashPost, type SavePostInput } from "@/lib/blog/posts";
import { getLivePost, listPosts, footerPages } from "@/lib/blog/public";
import { followRedirect } from "@/lib/seo/site";
import sitemap from "@/app/sitemap";
import { GET as feed } from "@/app/(shop)/blog/feed.xml/route";
import { prisma, setupIntegrationHarness } from "../support/harness";

setupIntegrationHarness();

const content = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
const draft = (over: Partial<SavePostInput> = {}): SavePostInput => ({ type: "POST", title: "Smoky Jollof Rice", contentJson: content("Jollof rice is the star of every party. Here is how to make it."), intent: "draft", ...over });

async function staff() {
  return prisma.staffUser.create({ data: { email: `writer-${Date.now()}@example.com`, name: "Ada Writer", role: "EDITOR", passwordHash: "x" } });
}

/** next/navigation redirects throw an error whose digest carries the target. */
async function redirectTarget(path: string) {
  try { await followRedirect(path); return null; } catch (error) { return String((error as { digest?: string }).digest ?? error); }
}

describe("blog posts", () => {
  it("drafts are private, publishing makes them live, and the address is made from the title", async () => {
    const me = await staff();
    const saved = await savePost(draft(), me.id);
    expect(saved).toMatchObject({ slug: "smoky-jollof-rice", status: "DRAFT", path: "/blog/smoky-jollof-rice" });
    expect(await getLivePost("POST", "smoky-jollof-rice")).toBeNull();

    const live = await savePost(draft({ id: saved.id, intent: "publish" }), me.id);
    expect(live.status).toBe("PUBLISHED");
    const post = await getLivePost("POST", "smoky-jollof-rice");
    expect(post).toMatchObject({ title: "Smoky Jollof Rice", author: { name: "Ada Writer" } });
    expect(post!.contentHtml).toBe("<p>Jollof rice is the star of every party. Here is how to make it.</p>");
    expect((await listPosts()).posts.map((p) => p.slug)).toEqual(["smoky-jollof-rice"]);

    // Same title again: its own address.
    expect((await savePost(draft(), me.id)).slug).toBe("smoky-jollof-rice-2");
  });

  it("a future publish date schedules the post: hidden until then", async () => {
    const me = await staff();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const saved = await savePost(draft({ intent: "publish", publishAt: later }), me.id);
    expect(saved.status).toBe("PUBLISHED");
    expect(await getLivePost("POST", saved.slug)).toBeNull();
    await prisma.post.update({ where: { id: saved.id }, data: { publishedAt: new Date(Date.now() - 1000) } });
    expect(await getLivePost("POST", saved.slug)).not.toBeNull();
  });

  it("publishing needs a title and some content", async () => {
    const me = await staff();
    await expect(savePost(draft({ title: "", intent: "publish" }), me.id)).rejects.toThrow(/Add a title/);
    await expect(savePost(draft({ contentJson: { type: "doc", content: [] }, intent: "publish" }), me.id)).rejects.toThrow(/Add some content/);
  });

  it("renaming a published post keeps the old address working, without chains", async () => {
    const me = await staff();
    const first = await savePost(draft({ intent: "publish" }), me.id);
    await savePost(draft({ id: first.id, intent: "save", slug: "jollof-rice-recipe" }), me.id);
    expect(await redirectTarget("/blog/smoky-jollof-rice")).toContain("/blog/jollof-rice-recipe");
    await savePost(draft({ id: first.id, intent: "save", slug: "best-jollof-rice" }), me.id);
    expect(await redirectTarget("/blog/smoky-jollof-rice")).toContain("/blog/best-jollof-rice");
    expect(await redirectTarget("/blog/jollof-rice-recipe")).toContain("/blog/best-jollof-rice");
    expect(await prisma.redirect.findUniqueOrThrow({ where: { fromPath: "/blog/smoky-jollof-rice" } })).toMatchObject({ hits: 2 });
    expect(await redirectTarget("/blog/never-existed")).toBeNull();
  });

  it("each save keeps a version; autosaves don't; restoring brings the words back", async () => {
    const me = await staff();
    const saved = await savePost(draft({ contentJson: content("First version.") }), me.id);
    await savePost(draft({ id: saved.id, contentJson: content("Autosaved typing") , intent: "save", autosave: true }), me.id);
    await savePost(draft({ id: saved.id, contentJson: content("Second version.") }), me.id);
    const revisions = await prisma.postRevision.findMany({ where: { postId: saved.id }, orderBy: { createdAt: "asc" } });
    expect(revisions).toHaveLength(2);
    await restoreRevision(revisions[0].id, me.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: saved.id } })).contentText).toBe("First version.");
    expect(await prisma.postRevision.count({ where: { postId: saved.id } })).toBe(3);
  });

  it("trash hides a post; restoring brings it back as a draft; only trashed posts can be deleted", async () => {
    const me = await staff();
    const saved = await savePost(draft({ intent: "publish" }), me.id);
    await expect(deletePostForever(saved.id, me.id)).rejects.toThrow(/trash first/);
    await trashPost(saved.id, me.id);
    expect(await getLivePost("POST", saved.slug)).toBeNull();
    await expect(savePost(draft({ id: saved.id }), me.id)).rejects.toThrow(/in the trash/);
    await restorePost(saved.id, me.id);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ status: "DRAFT", trashedAt: null });
    await trashPost(saved.id, me.id);
    await deletePostForever(saved.id, me.id);
    expect(await prisma.post.count()).toBe(0);
  });

  it("saves categories, tags, featured products and SEO, and stores a score", async () => {
    const me = await staff();
    const recipes = await saveBlogCategory(null, { name: "Recipes" }, me.id);
    const saved = await savePost(draft({ intent: "publish", categoryIds: [recipes.id], tags: ["Rice", "party food", "Rice"], focusKeyphrase: "jollof rice", seoDescription: "How to make smoky party jollof rice at home." }), me.id);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: saved.id }, include: { categories: true, tags: true } });
    expect(post.categories.map((c) => c.slug)).toEqual(["recipes"]);
    expect(post.tags.map((t) => t.slug).sort()).toEqual(["party-food", "rice"]);
    expect(post.seoScore).toEqual(expect.any(Number));
    expect((await listPosts({ categorySlug: "recipes" })).posts).toHaveLength(1);
    expect((await listPosts({ tagSlug: "party-food" })).posts).toHaveLength(1);
    expect((await listPosts({ q: "star of every party" })).posts).toHaveLength(1);
    await expect(savePost(draft({ productIds: ["missing-product"] }), me.id)).rejects.toThrow(/no longer exists/);
  });

  it("strips anything unsafe from what the editor sends", async () => {
    const me = await staff();
    const saved = await savePost(draft({
      intent: "publish",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(document.cookie)" } }] }, { type: "text", text: " <img src=x onerror=alert(1)>" }] }, { type: "script", content: [{ type: "text", text: "alert(2)" }] }] },
    }), me.id);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: saved.id } });
    expect(post.contentHtml).toBe("<p>click &lt;img src=x onerror=alert(1)&gt;</p>\n<p>alert(2)</p>");
    expect(JSON.stringify(post.contentJson)).not.toContain("javascript:");
  });
});

describe("pages", () => {
  it("pages get short addresses that can't clash with the shop, and can be listed in the footer", async () => {
    const me = await staff();
    const about = await savePost({ type: "PAGE", title: "About us", contentJson: content("We bring Nigerian groceries to your door."), intent: "publish", showInFooter: true }, me.id);
    expect(about.path).toBe("/about-us");
    const clash = await savePost({ type: "PAGE", title: "Shop", contentJson: content("A page called shop."), intent: "draft" }, me.id);
    expect(clash.slug).toBe("shop-page");
    expect(await footerPages()).toEqual([{ title: "About us", slug: "about-us" }]);
  });
});

describe("redirects and search engines", () => {
  it("staff redirects are validated and can't loop", async () => {
    const me = await staff();
    await saveRedirect({ from: "https://www.dorocityfoods.com/Old-Recipe/", to: "/blog/new-recipe", permanent: true }, me.id);
    expect(await redirectTarget("/old-recipe")).toContain("/blog/new-recipe");
    await expect(saveRedirect({ from: "/blog/new-recipe", to: "/old-recipe", permanent: true }, me.id)).rejects.toThrow(/circle/);
    await expect(saveRedirect({ from: "/admin/login", to: "/x", permanent: true }, me.id)).rejects.toThrow(/can't be redirected/);
  });

  it("the sitemap lists live posts and pages only, and the feed has the latest posts", async () => {
    const me = await staff();
    await savePost(draft({ intent: "publish" }), me.id);
    await savePost(draft({ title: "Secret draft" }), me.id);
    await savePost(draft({ title: "Hidden from Google", intent: "publish", noindex: true }), me.id);
    await savePost({ type: "PAGE", title: "Delivery", contentJson: content("We deliver across Nigeria."), intent: "publish" }, me.id);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining(["http://localhost:3000/blog/smoky-jollof-rice", "http://localhost:3000/delivery", "http://localhost:3000/blog"]));
    expect(urls.some((u) => u.includes("secret-draft") || u.includes("hidden-from-google"))).toBe(false);

    const xml = await (await feed()).text();
    expect(xml).toContain("<title>Smoky Jollof Rice</title>");
    expect(xml).not.toContain("Secret draft");

    await prisma.storeSetting.create({ data: { key: "seo.hideFromSearch", value: true } });
    expect(await sitemap()).toEqual([]);
  });
});
