import { DEFAULT_BASE_URL } from "./url";

export interface ApiProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface ApiProfilesDraft {
  apiProfiles: ApiProfile[];
  activeApiProfileId: string;
}

/** 同步当前请求使用的地址和 Key，始终从同一条配置取值。 */
export function apiProfilesPatch(draft: ApiProfilesDraft) {
  const active = draft.apiProfiles.find(
    (profile) => profile.id === draft.activeApiProfileId,
  );
  if (!active) return null;
  return {
    ...draft,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
  };
}

/** 兼容只有一组地址和 Key 的旧设置；失效的选中 id 回退到首条。 */
export function restoreApiProfiles(
  saved: Partial<ApiProfilesDraft & { baseUrl: string; apiKey: string }>,
) {
  const apiProfiles = saved.apiProfiles?.length
    ? saved.apiProfiles
    : [
        {
          id: "default",
          name: "",
          baseUrl: saved.baseUrl ?? DEFAULT_BASE_URL,
          apiKey: saved.apiKey ?? "",
        },
      ];
  const activeApiProfileId = apiProfiles.some(
    (profile) => profile.id === saved.activeApiProfileId,
  )
    ? saved.activeApiProfileId!
    : apiProfiles[0].id;
  return apiProfilesPatch({ apiProfiles, activeApiProfileId })!;
}
