/** 多尺寸舞台的排版（纯函数）：各图保持自身比例、同一行等高，按比例 chip 顺序排成一行；
 *  一行放下后格子过小就折成两行。生成中的占位与完成后的成品共用同一份排版 */

export interface Box {
  w: number;
  h: number;
}

export interface MultiLayout {
  /** 每行的格子序号，保持比例 chip 顺序 */
  rows: number[][];
  /** 格子高度（px）：所有行共用，同一行的格子等高，宽度 = 高度 × 宽高比 */
  height: number;
}

/** 格子之间的间距 */
export const MULTI_GAP = 12;
/** 每行格子下方的标注行占的高度（含与格子的间距） */
export const MULTI_CAPTION = 26;
/** 一行放下后格子矮于这个高度就改用两行 */
export const MULTI_MIN_HEIGHT = 200;

/** 详情浮卡占的宽度（270px + 右边距 14px），格子行左右各让出这块再留 24px，不压到它 */
const DETAIL_CARD = 270 + 14;
/** 内容区上下各留的空白：顶部要给生成中的状态胶囊和完成时的 toast（都在 84px 以内） */
const STAGE_MARGIN = 84;
/** 格子下方「共 N 个尺寸 · 下载全部」那一行（含间距）占的高度 */
const CAP_ROW = 42;

/** 窄屏断点，与 useNarrowViewport、stage.css 一致：详情浮卡默认收起，格子行可以用满屏宽 */
const NARROW_MAX = 760;
/** 窄屏舞台左右各留的边距（stage.css 的窄屏 padding） */
const NARROW_SIDE = 14;

/** 多尺寸排版可用的区域，随视口变化。与 stage.css 保持一致：舞台底部给创作条留 150px */
export function multiBox(viewport: Box): Box {
  if (viewport.w <= NARROW_MAX)
    return {
      w: Math.max(280, viewport.w - 2 * NARROW_SIDE),
      h: Math.max(200, viewport.h - 150 - 2 * STAGE_MARGIN - CAP_ROW),
    };
  return {
    w: Math.max(
      280,
      Math.round(
        Math.min(viewport.w * 0.6, viewport.w - 2 * (DETAIL_CARD + 24)),
      ),
    ),
    h: Math.max(200, viewport.h - 150 - 2 * STAGE_MARGIN - CAP_ROW),
  };
}

const sum = (items: readonly number[]) =>
  items.reduce((total, item) => total + item, 0);

/** 这些格子排成一行、撑满 width 时的格子高度 */
const heightForRow = (aspects: readonly number[], width: number) =>
  (width - MULTI_GAP * (aspects.length - 1)) / sum(aspects);

/** aspects 是各格的宽高比（宽 / 高），按比例 chip 顺序 */
export function layoutMulti(aspects: readonly number[], box: Box): MultiLayout {
  const all = aspects.map((_, index) => index);
  const oneRow = Math.min(heightForRow(aspects, box.w), box.h - MULTI_CAPTION);
  if (aspects.length < 2 || oneRow >= MULTI_MIN_HEIGHT)
    return { rows: [all], height: Math.max(1, Math.floor(oneRow)) };

  // 两行：在每个切分点里取格子最高的；同样高时取更均匀的切分
  const perRowMax = (box.h - MULTI_GAP - 2 * MULTI_CAPTION) / 2;
  let best: { split: number; height: number } | null = null;
  for (let split = 1; split < aspects.length; split++) {
    const height = Math.min(
      heightForRow(aspects.slice(0, split), box.w),
      heightForRow(aspects.slice(split), box.w),
      perRowMax,
    );
    const better =
      !best ||
      height > best.height ||
      (height === best.height &&
        Math.abs(split - aspects.length / 2) <
          Math.abs(best.split - aspects.length / 2));
    if (better) best = { split, height };
  }
  if (!best || best.height <= oneRow)
    return { rows: [all], height: Math.max(1, Math.floor(oneRow)) };
  return {
    rows: [all.slice(0, best.split), all.slice(best.split)],
    height: Math.max(1, Math.floor(best.height)),
  };
}
