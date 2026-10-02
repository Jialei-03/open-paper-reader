/** The picture of a boxed part of a PDF page, as a PNG. The server draws it from
 * the PDF itself, so it is sharp at any zoom and does not depend on how the
 * reader has rotated the page. */
async function regionPng(fileId: string, page: number, rect: string) {
  const response = await fetch(
    `/api/v1/agent/files/${fileId}/image?page=${page}&rect=${encodeURIComponent(rect)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "无法生成选区图片，请稍后重试",
    );
  }
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("无法生成选区图片"))),
      "image/png",
    ),
  );
}

/**
 * Puts a boxed part of a PDF page on the clipboard as a PNG that a note, a chat
 * or any editor can paste. Some browsers (and embedded views) do not let a page
 * write the clipboard; with `saveInstead` the picture is then kept as a file,
 * which notes and the assistant also take by drag and drop.
 * Resolves to what happened to the picture.
 */
export async function copyRegionImage(
  fileId: string,
  page: number,
  rect: string,
  {
    saveInstead = false,
    downloadOnly = false,
  }: { saveInstead?: boolean; downloadOnly?: boolean } = {},
): Promise<"copied" | "saved"> {
  // The clipboard write has to begin inside the click that asked for it, while
  // the picture is still being drawn, so the clipboard is handed a promise of it.
  const png = regionPng(fileId, page, rect);
  png.catch(() => undefined);
  try {
    if (downloadOnly) throw new Error("download requested");
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw new Error("no clipboard");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copied";
  } catch (error) {
    // A picture that could not be made has its own reason; say that one.
    const blob = await png;
    if (!saveInstead && !downloadOnly)
      throw new Error(
        "浏览器不允许网页写入剪贴板，请改用菜单里的「保存图片」，或在浏览器设置中允许剪贴板",
        { cause: error },
      );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `选区-第${page}页.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return "saved";
  }
}
