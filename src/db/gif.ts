/** GIF 项目与素材的 IndexedDB 读写；只做存储，不产出文案。
 *
 *  Safari / WebKit 的 IndexedDB 存 Blob 会失败（"Error preparing Blob/File data to be
 *  stored in object store"），所以落库统一存字节；源视频这类大文件仍按 Blob 存，
 *  避免在手机上把上百 MB 读进内存。 */
import { db } from "./schema";
import type { GifAsset, GifProject } from "../lib/gif/types";

/** 超过这个体积的素材仍以 Blob 存（省内存） */
const BLOB_LIMIT = 16 * 1024 * 1024;

/** 落库行：blob 与 bytes 二选一 */
export interface GifAssetRow extends Omit<GifAsset, "blob"> {
  blob?: Blob;
  bytes?: Uint8Array<ArrayBuffer>;
}

/** 项目行：旧版本把缩略图 Blob 放在文档里，读取时转成字节 */
interface GifProjectRow extends GifProject {
  thumbBlob?: Blob;
}

function toAsset(row: GifAssetRow): GifAsset {
  if (row.bytes)
    return {
      ...row,
      blob: new Blob([row.bytes], { type: row.mime }),
    } as GifAsset;
  return { ...row, blob: row.blob as Blob };
}

export async function listGifProjects(): Promise<GifProject[]> {
  const rows = await db.gifProjects.orderBy("updatedAt").reverse().toArray();
  return Promise.all(rows.map(migrateThumb));
}

export async function loadGifProject(id: string): Promise<GifProject | null> {
  const row = await db.gifProjects.get(id);
  if (!row) return null;
  return migrateThumb(row);
}

export async function loadGifAssets(
  projectId: string,
): Promise<Record<string, GifAsset>> {
  const rows = await db.gifAssets
    .where("projectId")
    .equals(projectId)
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.id, toAsset(row)]));
}

export async function putGifAsset(asset: GifAsset): Promise<void> {
  if (asset.blob.size <= BLOB_LIMIT) {
    const { blob, ...rest } = asset;
    await db.gifAssets.put({
      ...rest,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    } as GifAssetRow);
    return;
  }
  await db.gifAssets.put(asset as GifAssetRow);
}

export async function putGifProject(project: GifProject): Promise<void> {
  await db.gifProjects.put(project);
}

export async function deleteGifProjectData(id: string): Promise<void> {
  await db.transaction("rw", db.gifProjects, db.gifAssets, async () => {
    await db.gifProjects.delete(id);
    await db.gifAssets.where("projectId").equals(id).delete();
  });
}

export async function clearGifData(): Promise<void> {
  await db.transaction("rw", db.gifProjects, db.gifAssets, async () => {
    await db.gifProjects.clear();
    await db.gifAssets.clear();
  });
}

export async function getGifAsset(id: string): Promise<GifAsset | null> {
  const row = await db.gifAssets.get(id);
  return row ? toAsset(row) : null;
}

/** 旧项目把缩略图 Blob 塞在文档里：读出来就换成字节，避免下一次保存又失败 */
async function migrateThumb(row: GifProjectRow): Promise<GifProject> {
  const legacy = row.thumbBlob;
  if (!legacy) return row;
  const bytes = new Uint8Array(await legacy.arrayBuffer());
  const next = { ...row };
  delete next.thumbBlob;
  return { ...next, thumbBytes: bytes };
}
