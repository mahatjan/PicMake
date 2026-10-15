/** 只读打开旧页面的库 `ai_image_playground`。库不存在时不创建。 */

const LEGACY_NAME = "ai_image_playground";

export async function readLegacyVideoStore(): Promise<unknown[] | null> {
  if (typeof indexedDB === "undefined" || !indexedDB.databases) return null;
  const existing = await indexedDB.databases();
  if (!existing.some((item) => item.name === LEGACY_NAME)) return [];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_NAME);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("records")) {
        database.close();
        resolve([]);
        return;
      }
      const tx = database.transaction("records", "readonly");
      const all = tx.objectStore("records").getAll();
      all.onerror = () => {
        database.close();
        reject(all.error);
      };
      all.onsuccess = () => {
        database.close();
        resolve(all.result ?? []);
      };
    };
  });
}
