import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError } from "@/lib/commerce/errors";
import { deleteStoredObject, uploadImage } from "@/lib/integrations/storage";

/** The media library: every uploaded image, reusable in posts, pages and products. */

export async function uploadMedia(file: File, altText: string, actorId: string) {
  const uploaded = await uploadImage(file, "media");
  const fileName = (file.name || "image").replace(/[^\w.\- ]+/g, "").slice(0, 120) || "image";
  return prisma.$transaction(async (tx) => {
    const media = await tx.media.create({
      data: { url: uploaded.url, storageKey: uploaded.key, fileName, contentType: uploaded.contentType, sizeBytes: uploaded.sizeBytes, altText: altText.trim().slice(0, 300), createdBy: actorId },
    });
    await recordAudit(tx, { action: "MEDIA_UPLOADED", entityType: "Media", entityId: media.id, actorId, metadata: { fileName, sizeBytes: uploaded.sizeBytes } });
    return media;
  });
}

export async function updateMediaAlt(id: string, altText: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const media = await tx.media.update({ where: { id }, data: { altText: altText.trim().slice(0, 300) } });
    await recordAudit(tx, { action: "MEDIA_UPDATED", entityType: "Media", entityId: id, actorId });
    return media;
  });
}

/** Removes it from the library and from storage. Posts that used it will show a missing image. */
export async function deleteMedia(id: string, actorId: string) {
  const media = await prisma.media.findUnique({ where: { id } });
  if (!media) throw new CommerceError("NOT_FOUND", 404, "That image was already deleted.");
  await prisma.$transaction(async (tx) => {
    await tx.media.delete({ where: { id } });
    await recordAudit(tx, { action: "MEDIA_DELETED", entityType: "Media", entityId: id, actorId, metadata: { fileName: media.fileName } });
  });
  if (media.storageKey) await deleteStoredObject(media.storageKey);
}

export async function listMedia({ page = 1, pageSize = 40, q = "" } = {}) {
  const where = q ? { OR: [{ fileName: { contains: q, mode: "insensitive" as const } }, { altText: { contains: q, mode: "insensitive" as const } }] } : {};
  const rows = await prisma.media.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize + 1 });
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}
