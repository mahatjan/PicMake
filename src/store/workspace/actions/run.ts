/** 每次提交独立的生成生命周期；迟到事件必须按任务 id 匹配。 */
import type { PreparedGeneration } from "../../../lib/generation";
import type { ApiErrorKind } from "../../../lib/types";
import type { GenPlan } from "../../../lib/view-models";
import { uuid } from "../../../lib/uuid";
import { useWorkspace, type GenerationTask, type RunSlot } from "../index";
import { set, freshDraft } from "./internal";

export function beginRun(
  plan: GenPlan,
  task = {
    id: uuid(),
    prompt: useWorkspace.getState().draft.form.prompt,
    model: useWorkspace.getState().draft.form.model,
  },
): boolean {
  if (useWorkspace.getState().tasks.some((item) => item.id === task.id))
    return false;
  const slots: RunSlot[] | null = plan.sizes
    ? plan.sizes.map((size) => ({
        size,
        status: "running",
        partial: null,
        final: null,
        failure: null,
      }))
    : null;
  set((s) => ({
    tasks: [
      {
        ...task,
        run: { phase: "generating", plan, partial: null, slots },
        submittedDraft: s.draft,
      },
      ...s.tasks,
    ],
    history: { ...s.history, recent: s.tasks.length ? s.history.recent : null },
    nav: { ...s.nav, selectedId: null, lastDoneId: null },
    view: { ...s.view, focusIdx: null, lightboxId: null, previewId: null },
  }));
  return true;
}

const updateTask = (
  id: string | undefined,
  update: (task: GenerationTask) => GenerationTask,
) =>
  set((s) => {
    const task = id ? s.tasks.find((item) => item.id === id) : s.tasks[0];
    if (!task) return s;
    const next = update(task);
    return next === task
      ? s
      : { tasks: s.tasks.map((item) => (item === task ? next : item)) };
  });

export const setPartial = (blob: Blob, index: number, id?: string) =>
  updateTask(id, (task) =>
    task.run.phase === "generating"
      ? { ...task, run: { ...task.run, partial: { blob, index } } }
      : task,
  );

const updateSlot = (
  index: number,
  update: (slot: RunSlot) => RunSlot,
  id?: string,
) =>
  updateTask(id, (task) => {
    const run = task.run;
    if (run.phase !== "generating" || !run.slots) return task;
    const slot = run.slots[index];
    if (!slot || slot.status !== "running") return task;
    return {
      ...task,
      run: {
        ...run,
        slots: run.slots.map((item, at) =>
          at === index ? update(item) : item,
        ),
      },
    };
  });

export const setSlotPartial = (index: number, partial: Blob, id?: string) =>
  updateSlot(index, (slot) => ({ ...slot, partial }), id);
export const setSlotDone = (index: number, final: Blob, id?: string) =>
  updateSlot(
    index,
    (slot) => ({ ...slot, status: "done", partial: null, final }),
    id,
  );
export const setSlotFailed = (
  index: number,
  failure: ApiErrorKind,
  id?: string,
) =>
  updateSlot(
    index,
    (slot) => ({ ...slot, status: "failed", partial: null, failure }),
    id,
  );

/** 只结束指定任务，其他生成和未保存结果不受影响。 */
export const endRun = (id?: string) =>
  set((s) => {
    const task = id ? s.tasks.find((item) => item.id === id) : s.tasks[0];
    return task?.run.phase === "generating"
      ? { tasks: s.tasks.filter((item) => item !== task) }
      : s;
  });

export const beginSave = (prepared: PreparedGeneration, id?: string) =>
  updateTask(id, (task) =>
    task.run.phase === "generating"
      ? { ...task, run: { phase: "saving", prepared } }
      : task,
  );
export const markUnsaved = (id?: string) =>
  updateTask(id, (task) =>
    task.run.phase === "saving"
      ? { ...task, run: { phase: "unsaved", prepared: task.run.prepared } }
      : task,
  );
export const discardUnsaved = (id?: string) =>
  set((s) => {
    const task = id
      ? s.tasks.find((item) => item.id === id)
      : s.tasks.find((item) => item.run.phase === "unsaved");
    return task?.run.phase === "unsaved"
      ? { tasks: s.tasks.filter((item) => item !== task) }
      : s;
  });

/** 保存只收尾自己的任务；其他任务仍显示，新的草稿和已打开画板不被复位。 */
export const finishSave = (prepared: PreparedGeneration, id?: string) =>
  set((s) => {
    const task = id ? s.tasks.find((item) => item.id === id) : s.tasks[0];
    if (id && task?.run.phase !== "saving") return s;
    const tasks = s.tasks.filter((item) => item !== task);
    const active = tasks.some((item) => item.run.phase !== "unsaved");
    const sameDraft = !task || s.draft === task.submittedDraft;
    return {
      tasks,
      history: { ...s.history, recent: prepared },
      nav: {
        ...s.nav,
        lastDoneId: prepared.row.id,
        ...(active ? {} : { returnId: null }),
      },
      draft:
        s.draft.dirty || !sameDraft || active || s.drawing
          ? s.draft
          : freshDraft(s.draft),
    };
  });
