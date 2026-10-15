/** 视频工作台：把草稿、记录和封面 URL 投影成展示组件，操作交给 flows。
 *  封面与表单图片的 Object URL 只在工作台打开时创建，关掉即回收。 */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Playground } from "../components/video/Playground";
import { VideoPreview } from "../components/video/VideoPreview";
import { VideoSheet } from "../components/video/VideoSheet";
import { copyPrompt } from "../flows/export";
import {
  addVideoFiles,
  confirmClearVideos,
  deleteVideo,
  downloadVideo,
  reuseVideo,
  submitVideo,
} from "../flows/video";
import { useBlobUrls } from "../hooks/useBlobUrls";
import {
  defaultSeedFor,
  FRAME_WORKFLOW_ID,
  isKnownWorkflow,
  refWorkflows,
  resolutionOptions,
  VIDEO_DURATION_MAX,
  VIDEO_MAX_REFS,
  VIDEO_PROMPT_MAX,
  type VideoFailCode,
  type VideoRecord,
} from "../lib/video";
import { useWorkspace } from "../store/workspace";
import {
  clearVideoRefs,
  closePlayground,
  closeVideoEntry,
  closeVideoPreview,
  openBar,
  openVideoEntry,
  openVideoPreview,
  removeVideoRef,
  setCustomInput,
  setCustomWorkflowId,
  setVideoDuration,
  setVideoFrame,
  setVideoPrompt,
  setVideoResolution,
  setVideoSeed,
  setVideoWorkflow,
} from "../store/workspace/actions";

const EMPTY_ROWS: VideoRecord[] = [];

export function PlaygroundArea() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.view.playgroundOpen);
  const draft = useWorkspace((s) => s.video.draft);
  const rows = useWorkspace((s) => s.video.rows);
  const submitting = useWorkspace((s) => s.video.submitting);
  const previewId = useWorkspace((s) => s.video.previewId);
  const labelOf = (id: string) =>
    isKnownWorkflow(id)
      ? (t as (key: string) => string)(`video.workflowName.${id}`)
      : id;
  const failText = (error: string | null, code: VideoFailCode | null) =>
    error ||
    (code ? (t as (key: string) => string)(`video.fail.${code}`) : null);

  const list = rows ?? EMPTY_ROWS;
  const coverBlobs = useMemo(
    () => (open ? list.map((row) => row.refs[0]?.blob ?? null) : []),
    [open, list],
  );
  const coverUrls = useBlobUrls(coverBlobs);
  const refBlobs = useMemo(
    () => (open ? draft.refs.map((ref) => ref.blob) : []),
    [open, draft.refs],
  );
  const refUrls = useBlobUrls(refBlobs);
  const frameBlobs = useMemo(
    () =>
      open
        ? [draft.frames.first?.blob ?? null, draft.frames.last?.blob ?? null]
        : [],
    [open, draft.frames],
  );
  const frameUrls = useBlobUrls(frameBlobs);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || useWorkspace.getState().confirm) return;
      const video = useWorkspace.getState().video;
      if (video.previewId) closeVideoPreview();
      else if (video.draft.entry) closeVideoEntry();
      else closePlayground();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const entry = draft.entry;
  const workflowId =
    entry === "frames"
      ? FRAME_WORKFLOW_ID
      : entry === "custom"
        ? draft.customWorkflowId.trim()
        : draft.refWorkflowId;
  const seedKey =
    entry === "custom" ? draft.customWorkflowId.trim() : workflowId;
  const seed = Object.prototype.hasOwnProperty.call(draft.seeds, seedKey)
    ? draft.seeds[seedKey]
    : defaultSeedFor(seedKey || FRAME_WORKFLOW_ID);
  const preview = list.find((row) => row.id === previewId) ?? null;
  const previewIndex = preview ? list.indexOf(preview) : -1;

  return (
    <>
      <Playground
        rows={
          rows === null
            ? null
            : list.map((row, index) => ({
                id: row.id,
                status: row.status,
                prompt: row.prompt,
                meta: t("video.cardMeta", {
                  resolution: row.resolution,
                  duration: row.duration,
                }),
                coverUrl: coverUrls[index] ?? null,
                error: failText(row.error, row.failCode),
              }))
        }
        onClose={closePlayground}
        onImage={() => {
          closePlayground();
          openBar();
        }}
        onEntry={openVideoEntry}
        onOpen={openVideoPreview}
        onClear={confirmClearVideos}
      />
      {entry && (
        <VideoSheet
          entry={entry}
          prompt={draft.prompt}
          promptMax={VIDEO_PROMPT_MAX}
          duration={draft.duration}
          durationMax={VIDEO_DURATION_MAX}
          workflowId={
            entry === "frames" ? FRAME_WORKFLOW_ID : draft.refWorkflowId
          }
          workflowOptions={refWorkflows().map((workflow) => ({
            id: workflow.id,
            label: labelOf(workflow.id),
          }))}
          customWorkflowId={draft.customWorkflowId}
          customInput={draft.customInput}
          resolution={draft.resolution}
          resolutions={resolutionOptions({
            entry,
            workflowId:
              draft.entry === "frames"
                ? FRAME_WORKFLOW_ID
                : draft.refWorkflowId,
          })}
          seed={seed}
          refs={draft.refs.map((ref, index) => ({
            id: ref.id,
            name: ref.name,
            url: refUrls[index] ?? null,
          }))}
          refMax={VIDEO_MAX_REFS}
          frames={{
            first: draft.frames.first
              ? {
                  id: draft.frames.first.id,
                  name: draft.frames.first.name,
                  url: frameUrls[0] ?? null,
                }
              : null,
            last: draft.frames.last
              ? {
                  id: draft.frames.last.id,
                  name: draft.frames.last.name,
                  url: frameUrls[1] ?? null,
                }
              : null,
          }}
          submitting={submitting}
          onPrompt={setVideoPrompt}
          onDuration={setVideoDuration}
          onWorkflow={setVideoWorkflow}
          onCustomId={setCustomWorkflowId}
          onCustomInput={setCustomInput}
          onResolution={setVideoResolution}
          onSeed={setVideoSeed}
          onFiles={addVideoFiles}
          onRemoveRef={removeVideoRef}
          onClearRefs={clearVideoRefs}
          onRemoveFrame={(slot) => setVideoFrame(slot, null)}
          onSubmit={() => void submitVideo()}
          onClose={closeVideoEntry}
        />
      )}
      {preview && (
        <VideoPreview
          status={preview.status}
          prompt={preview.prompt}
          meta={t("video.cardMeta", {
            resolution: preview.resolution,
            duration: preview.duration,
          })}
          url={preview.remoteUrl}
          coverUrl={
            previewIndex >= 0 ? (coverUrls[previewIndex] ?? null) : null
          }
          error={failText(preview.error, preview.failCode)}
          onClose={closeVideoPreview}
          onDownload={() => downloadVideo(preview.id)}
          onCopy={() => copyPrompt(preview.prompt)}
          onReuse={() => reuseVideo(preview.id)}
          onDelete={() => deleteVideo(preview.id)}
        />
      )}
    </>
  );
}
