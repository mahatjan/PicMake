/** GIF 工作台素材：视频 URL、图片位图、GIF 帧、图层渲染资源与缩略图 URL。
 *  Object URL 只在这里创建/回收；解码结果随项目素材键变化重建。 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GifAsset, GifProject } from "../lib/gif/types";
import {
  closeDecodedGif,
  decodeGif as decodeGifFile,
  type DecodedGif,
} from "../lib/gif/decode";
import { decodeImage } from "../lib/gif/media";
import type { GifRenderAsset, GifRenderAssets } from "../lib/gif/render";
import { useBlobUrls } from "./useBlobUrls";
import { useObjectUrl } from "./useObjectUrl";

export interface GifAssetView {
  sourceUrl: string | null;
  sourceImage: ImageBitmap | null;
  sourceGif: DecodedGif | null;
  render: GifRenderAssets;
  urls: Record<string, string>;
  loading: boolean;
}

export function useGifAssets(
  project: GifProject | null,
  assets: Record<string, GifAsset>,
): GifAssetView {
  const sourceBlob =
    project?.source.kind === "video"
      ? assets[project.source.assetId]?.blob
      : undefined;
  const sourceUrl = useObjectUrl(sourceBlob);

  const imageLayerIds = useMemo(
    () =>
      project
        ? project.layers
            .filter((layer) => layer.kind === "image" || layer.kind === "gif")
            .map((layer) => layer.assetId)
        : [],
    [project],
  );
  const blobs = useMemo(() => {
    if (!project) return [];
    const ids = [
      ...(project.source.kind === "video" ? [] : [project.source.assetId]),
      ...imageLayerIds,
    ];
    return ids.map((id) => assets[id]?.blob ?? null);
    // assets 变化时项目素材可能刚写入
  }, [project, imageLayerIds, assets]);
  const urls = useBlobUrls(blobs);
  const [view, setView] = useState<Omit<GifAssetView, "sourceUrl" | "urls">>({
    sourceImage: null,
    sourceGif: null,
    render: {},
    loading: false,
  });
  const resourcesRef = useRef<(() => void)[]>([]);

  const key = useMemo(() => {
    if (!project) return "";
    const layers = project.layers
      .filter((layer) => layer.kind === "image" || layer.kind === "gif")
      .map((layer) => `${layer.kind}:${layer.assetId}`)
      .join(",");
    return `${project.id}|${project.source.kind}:${project.source.assetId}|${layers}`;
  }, [project]);

  const projectRef = useRef(project);
  const assetsRef = useRef(assets);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    const project = projectRef.current;
    const assets = assetsRef.current;
    if (!project) {
      setView({
        sourceImage: null,
        sourceGif: null,
        render: {},
        loading: false,
      });
      const previous = resourcesRef.current;
      resourcesRef.current = [];
      if (previous.length)
        setTimeout(() => previous.forEach((fn) => fn()), 400);
      return;
    }
    let cancelled = false;
    const closers: (() => void)[] = [];
    setView((prev) => ({
      ...prev,
      sourceImage: null,
      sourceGif: null,
      render: {},
      loading: true,
    }));
    void (async () => {
      try {
        let sourceImage: ImageBitmap | null = null;
        let sourceGif: DecodedGif | null = null;
        const render: GifRenderAssets = {};
        const sourceAsset = assets[project.source.assetId];
        if (project.source.kind === "image" && sourceAsset) {
          const decoded = await decodeImage(sourceAsset.blob, 1920);
          sourceImage = decoded.bitmap;
          closers.push(() => decoded.bitmap.close());
        } else if (project.source.kind === "gif" && sourceAsset) {
          sourceGif = await decodeGifFile(sourceAsset.blob, {
            maxFrames: 300,
            maxSide: 1024,
          });
          closers.push(() => sourceGif && closeDecodedGif(sourceGif));
        }
        for (const layer of project.layers) {
          if (layer.kind !== "image" && layer.kind !== "gif") continue;
          const asset = assets[layer.assetId];
          if (!asset) continue;
          if (layer.kind === "image") {
            const decoded = await decodeImage(asset.blob, 1600);
            const item: GifRenderAsset = {
              image: decoded.bitmap,
              width: decoded.width,
              height: decoded.height,
            };
            render[layer.assetId] = item;
            closers.push(() => decoded.bitmap.close());
          } else {
            const gif = await decodeGifFile(asset.blob, {
              maxFrames: 120,
              maxSide: 640,
            });
            render[layer.assetId] = {
              gif: {
                frames: gif.frames,
                durations: gif.durations,
                totalMs: gif.totalMs,
                width: gif.width,
                height: gif.height,
              },
              width: gif.width,
              height: gif.height,
            };
            closers.push(() => closeDecodedGif(gif));
          }
        }
        if (cancelled) {
          // 被新素材替换：延迟回收，避免旧 render 还在本次绘制里
          setTimeout(() => closers.forEach((fn) => fn()), 400);
          return;
        }
        setView({
          sourceImage,
          sourceGif,
          render,
          loading: false,
        });
        const previous = resourcesRef.current;
        resourcesRef.current = closers;
        // 旧位图可能还被当前一帧绘制引用，等 React 提交后再关闭
        if (previous.length)
          setTimeout(() => previous.forEach((fn) => fn()), 400);
      } catch {
        if (cancelled) return;
        setView({
          sourceImage: null,
          sourceGif: null,
          render: {},
          loading: false,
        });
        const previous = resourcesRef.current;
        resourcesRef.current = [];
        if (previous.length)
          setTimeout(() => previous.forEach((fn) => fn()), 400);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只按素材键重建；拖动/改样式不重新解码
  }, [key]);

  useEffect(() => {
    return () => {
      resourcesRef.current.forEach((fn) => fn());
    };
  }, []);

  const urlMap = useMemo(() => {
    if (!project) return {};
    const ids = [
      ...(project.source.kind === "video" ? [] : [project.source.assetId]),
      ...imageLayerIds,
    ];
    return Object.fromEntries(
      ids.flatMap((id, index) =>
        urls[index] ? ([[id, urls[index]]] as const) : [],
      ),
    );
  }, [project, imageLayerIds, urls]);

  return { ...view, sourceUrl, urls: urlMap };
}
