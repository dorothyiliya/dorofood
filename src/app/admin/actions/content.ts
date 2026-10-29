"use server";

import { revalidatePath } from "next/cache";
import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, id, text } from "@/lib/admin/form";
import { prisma } from "@/lib/prisma";
import { deleteBlogCategory, deleteBlogTag, deletePostForever, deleteRedirect, restorePost, restoreRevision, saveBlogCategory, savePost, saveRedirect, trashPost, type SavePostInput } from "@/lib/blog/posts";
import { deleteMedia, listMedia, updateMediaAlt, uploadMedia } from "@/lib/content/media";
import { chat, cleanDraft, getAiConfig } from "@/lib/integrations/ai";
import { SETTINGS, updateSettings, type SettingKey } from "@/lib/settings";

/** Public pages that show posts: rebuilt straight away after a change. */
function refreshPublic(path?: string) {
  revalidatePath("/blog", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/", "layout");
  if (path) revalidatePath(path);
}

type Result<T> = { ok: boolean; message: string; at: number; data?: T; redirectTo?: string };

async function run<T>(permission: Parameters<typeof adminAction>[0], fn: (staffId: string) => Promise<{ message: string; data?: T }>, options: { revalidate?: boolean } = {}): Promise<Result<T>> {
  let data: T | undefined;
  const state = await adminAction(permission, async (staff) => {
    const out = await fn(staff.id);
    data = out.data;
    return out.message;
  }, { revalidate: options.revalidate ?? false });
  return { ...(state ?? { ok: false, message: "Something went wrong.", at: Date.now() }), data };
}

/* ---------------------------------------------------------------- the editor */

export async function savePostAction(input: SavePostInput) {
  return run("content.manage", async (staffId) => {
    // Public pages are refreshed by the editor through /api/admin/revalidate, not here:
    // revalidating in an action refreshes the admin page while someone is typing.
    const saved = await savePost(input, staffId);
    const live = saved.status === "PUBLISHED" && saved.publishedAt && saved.publishedAt <= new Date();
    const scheduled = saved.status === "PUBLISHED" && !live;
    const message = input.autosave ? "Draft saved." : input.intent === "publish" ? (scheduled ? "Scheduled." : "Published.") : input.intent === "draft" && saved.status === "DRAFT" ? "Saved as a draft." : "Saved.";
    return { message, data: { ...saved, publishedAt: saved.publishedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() } };
  });
}

export async function restoreRevisionAction(revisionId: string) {
  return run("content.manage", async (staffId) => {
    const saved = await restoreRevision(revisionId, staffId);
    refreshPublic(saved.path);
    return { message: "That version has been restored.", data: { id: saved.id } };
  });
}

/** Asks the AI integration for a Google description based on the post. */
export async function suggestDescriptionAction(input: { title: string; keyphrase: string; text: string }) {
  return run("content.manage", async () => {
    const config = await getAiConfig();
    const raw = await chat(config, [
      { role: "system", content: "You write meta descriptions for Google search results for a Nigerian food shop's website. Write one or two sentences, 120 to 155 characters in total, plain British English, inviting people to click. Include the focus keyphrase naturally if one is given. Use only facts from the text. No quotation marks, emoji or hashtags. Reply with the description only." },
      { role: "user", content: `Title: ${input.title.slice(0, 200)}\nFocus keyphrase: ${input.keyphrase.slice(0, 100) || "(none)"}\nText:\n${input.text.slice(0, 3000)}` },
    ], { maxTokens: 120, temperature: 0.5 });
    const description = cleanDraft(raw, 170);
    if (description.length < 40) throw new RangeError("The suggestion wasn't usable. Try again.");
    return { message: "Suggestion ready. Edit it if you like.", data: { description } };
  });
}

/* ------------------------------------------------------------ list actions */

export async function trashPostAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await trashPost(id(form, "postId"), staff.id);
    refreshPublic();
    return "Moved to the trash.";
  });
}

export async function restorePostAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await restorePost(id(form, "postId"), staff.id);
    return "Restored as a draft.";
  });
}

export async function deletePostForeverAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await deletePostForever(id(form, "postId"), staff.id);
    return "Deleted for good.";
  });
}

/* --------------------------------------------------------------- media */

export async function uploadMediaAction(form: FormData) {
  return run("content.manage", async (staffId) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new RangeError("Choose a picture to upload.");
    const media = await uploadMedia(file, text(form, "altText", 300), staffId);
    return { message: "Uploaded.", data: { id: media.id, url: media.url, altText: media.altText, fileName: media.fileName } };
  }, { revalidate: true });
}

export async function listMediaAction(input: { page?: number; q?: string }) {
  return run("content.manage", async () => {
    const result = await listMedia({ page: Math.max(1, Math.min(500, Number(input.page) || 1)), q: (input.q ?? "").slice(0, 100), pageSize: 24 });
    return { message: "", data: { hasNext: result.hasNext, items: result.items.map((m) => ({ id: m.id, url: m.url, altText: m.altText, fileName: m.fileName })) } };
  });
}

export async function updateMediaAltAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await updateMediaAlt(id(form, "mediaId"), text(form, "altText", 300), staff.id);
    return "Saved.";
  });
}

export async function deleteMediaAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await deleteMedia(id(form, "mediaId"), staff.id);
    return "Deleted.";
  });
}

/* ------------------------------------------------------ categories and tags */

export async function saveBlogCategoryAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    const categoryId = text(form, "categoryId", 64) || null;
    await saveBlogCategory(categoryId, { name: text(form, "name", 60), slug: text(form, "slug", 80), description: text(form, "description", 500) }, staff.id);
    refreshPublic();
    return categoryId ? "Saved." : "Category added.";
  });
}

export async function quickAddCategoryAction(name: string) {
  return run("content.manage", async (staffId) => {
    const category = await saveBlogCategory(null, { name }, staffId);
    return { message: "Category added.", data: { id: category.id, name: category.name } };
  });
}

export async function deleteBlogCategoryAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await deleteBlogCategory(id(form, "categoryId"), staff.id);
    refreshPublic();
    return "Category deleted. Its posts are kept.";
  });
}

export async function deleteBlogTagAction(_: ActionState, form: FormData) {
  return adminAction("content.manage", async (staff) => {
    await deleteBlogTag(id(form, "tagId"), staff.id);
    refreshPublic();
    return "Tag deleted. Its posts are kept.";
  });
}

/* --------------------------------------------------------------------- SEO */

const SEO_KEYS = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => "group" in SETTINGS[k]);

export async function saveSeoSettingsAction(_: ActionState, form: FormData) {
  return adminAction("seo.manage", async (staff) => {
    const changes: Partial<Record<SettingKey, unknown>> = {};
    for (const key of SEO_KEYS) {
      if (!form.has(`present:${key}`)) continue;
      changes[key] = typeof SETTINGS[key].default === "boolean" ? checkbox(form, key) : text(form, key, 2000);
    }
    await updateSettings(changes, staff.id);
    refreshPublic();
    return "Saved. Search engines will see the changes next time they visit.";
  });
}

export async function saveRedirectAction(_: ActionState, form: FormData) {
  return adminAction("seo.manage", async (staff) => {
    await saveRedirect({ from: text(form, "from", 500), to: text(form, "to", 2000), permanent: text(form, "kind", 10) !== "temporary", note: text(form, "note", 200) }, staff.id);
    return "Redirect saved.";
  });
}

export async function deleteRedirectAction(_: ActionState, form: FormData) {
  return adminAction("seo.manage", async (staff) => {
    await deleteRedirect(id(form, "redirectId"), staff.id);
    return "Redirect removed.";
  });
}

/** Products a post can feature, for the editor's picker. */
export async function productChoicesAction() {
  return run("content.manage", async () => {
    const rows = await prisma.product.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, media: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 } }, take: 500 });
    return { message: "", data: rows.map((r) => ({ id: r.id, name: r.name, image: r.media[0]?.url ?? null })) };
  });
}
