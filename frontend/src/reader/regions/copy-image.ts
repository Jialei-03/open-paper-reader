/**
 * The picture of a boxed part of a page as a PNG, and onto the clipboard. The
 * server draws it from the PDF (sharp at any zoom); a browser that does not let
 * the page write the clipboard gets the picture as a file instead.
 */
async function regionPng(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("image");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("image"))),
      "image/png",
    ),
  );
}

/** Resolves to what happened to the picture; rejects when it could not be made at all. */
export async function copyRegionImage(
  url: string,
  fileName: string,
): Promise<"copied" | "saved"> {
  // The clipboard write has to begin inside the click that asked for it, while
  // the picture is still being drawn, so the clipboard is handed a promise of it.
  const png = regionPng(url);
  png.catch(() => undefined);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw new Error("no clipboard");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copied";
  } catch {
    const blob = await png;
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return "saved";
  }
}
