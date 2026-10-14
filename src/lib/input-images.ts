import type { ImageRow } from "../db/schema";
import { ApiError, MAX_INPUT_BYTES, type OutputFormat } from "./types";
import { uuid } from "./uuid";

export function imageFormat(bytes: Uint8Array): OutputFormat | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

export async function readInputImage(file: File): Promise<ImageRow> {
  if (!file.size || file.size >= MAX_INPUT_BYTES)
    throw new ApiError("image-too-large", "");
  const format = imageFormat(
    new Uint8Array(await file.slice(0, 12).arrayBuffer()),
  );
  if (!format) throw new ApiError("invalid-image", "");
  const blob = file.slice(0, file.size, `image/${format}`);
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    return { id: uuid(), blob, width, height, format };
  } catch {
    throw new ApiError("invalid-image", "");
  }
}
