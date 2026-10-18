"""Untrusted document rendering in a CPU/memory bounded process, without network."""

import base64
import io
import json
import resource
import sys
import tarfile
import warnings
from pathlib import PurePosixPath

FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"}


def archive_images(raw, selected=""):
    rows, found, seen, total = [], None, set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r|*") as archive:
        for index, member in enumerate(archive):
            total += member.size
            p = PurePosixPath(member.name)
            if index >= 3000 or total > 150 * 1024**2:
                raise ValueError("源码包超出限制")
            if (
                p.is_absolute()
                or ".." in p.parts
                or "\\" in member.name
                or len(member.name) > 500
                or p in seen
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("源码包包含不安全的路径或链接")
            seen.add(p)
            if member.isfile() and p.suffix.lower() in FORMATS | {".svg", ".eps"}:
                rows.append(
                    {"asset": member.name, "supported": p.suffix.lower() in FORMATS}
                )
                if selected == member.name:
                    if member.size > 50 * 1024**2:
                        raise ValueError("图片文件超出 50 MiB 限制")
                    found = archive.extractfile(member).read()
    if selected and found is None:
        raise ValueError("源码中没有这张图片，请先列出图片获取准确名称")
    return rows, found


def is_pdf(raw):
    # The format allows stray bytes before the header, within the first 1024.
    return b"%PDF-" in raw[:1024]


def box_text(raw, page, rect):
    """The text of a PDF page that lies inside a box given as fractions of the page."""
    if not is_pdf(raw):
        return {"text": ""}
    import pypdfium2 as pdfium

    with pdfium.PdfDocument(raw) as pdf:
        if not 1 <= page <= len(pdf) <= 3000:
            raise ValueError("PDF 页码超出范围")
        p = pdf[page - 1]
        # Coordinates of a rotated page are not the ones the reader boxed; the
        # picture of the box still says what is in it.
        if p.get_rotation():
            return {"text": ""}
        width, height = p.get_size()
        x, y, w, h = rect
        text = p.get_textpage().get_text_bounded(
            left=x * width,
            bottom=(1 - y - h) * height,
            right=(x + w) * width,
            top=(1 - y) * height,
        )
    return {"text": " ".join(text.split())[:20000]}


def main():
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    request = json.loads(sys.stdin.buffer.readline(4096))
    with open(request["path"], "rb") as f:
        raw = f.read(50 * 1024**2 + 1)
    if len(raw) > 50 * 1024**2:
        raise ValueError("附件超出 50 MiB 限制")
    if request["operation"] == "captions":
        from figure_captions import extract

        return extract(raw)
    if request["operation"] == "list":
        rows, _ = archive_images(raw)
        return {"assets": rows}
    if request["operation"] == "text":
        return box_text(raw, request["page"], request["rect"])
    if request.get("asset"):
        _, raw = archive_images(raw, request["asset"])
        if PurePosixPath(request["asset"]).suffix.lower() not in FORMATS:
            raise ValueError("SVG / EPS 暂不转换，请查看论文中的对应 PDF 页面")
    from PIL import Image, ImageOps

    page = request["page"]
    if is_pdf(raw):
        import pypdfium2 as pdfium

        with pdfium.PdfDocument(raw) as pdf:
            if not 1 <= page <= len(pdf) <= 3000:
                raise ValueError("PDF 页码超出范围")
            p = pdf[page - 1]
            width, height = p.get_size()
            if min(width, height) <= 0:
                raise ValueError("PDF 页面尺寸无效")
            rect = request.get("rect")
            if rect:
                x, y, w, h = rect
                if w * width < 1 or h * height < 1:
                    raise ValueError("选区太小，请扩大选区")
                crop = (
                    x * width,
                    (1 - y - h) * height,
                    (1 - x - w) * width,
                    y * height,
                )
                bitmap = p.render(
                    scale=min(6, 1800 / max(w * width, h * height)),
                    crop=tuple(max(0, n) for n in crop),
                )
            else:
                bitmap = p.render(scale=min(2, 1800 / max(width, height)))
            im = bitmap.to_pil().convert("RGB")
            bitmap.close()
    else:
        if page != 1:
            raise ValueError("图片只有一页")
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
                raise ValueError("不支持的图片格式")
            source.seek(0)
            source.thumbnail((1800, 1800))
            rgba = ImageOps.exif_transpose(source).convert("RGBA")
            im = Image.new("RGB", rgba.size, "white")
            im.paste(rgba, mask=rgba.getchannel("A"))
    if request.get("rect") and not is_pdf(raw):
        x, y, w, h = request["rect"]
        im = im.crop(
            (
                int(x * im.width),
                int(y * im.height),
                max(int((x + w) * im.width), int(x * im.width) + 1),
                max(int((y + h) * im.height), int(y * im.height) + 1),
            )
        )
    out = io.BytesIO()
    im.save(out, "JPEG", quality=88)
    if out.tell() > 2 * 1024**2:
        raise ValueError("渲染图片超出大小限制")
    return {
        "data": base64.b64encode(out.getvalue()).decode(),
        "mimeType": "image/jpeg",
        "width": im.width,
        "height": im.height,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except ValueError as e:
        print(json.dumps({"error": str(e)[:200]}))
    except Exception:  # noqa: BLE001 - isolated untrusted parser, never expose paths
        print(json.dumps({"error": "无法解析图片或 PDF；请检查附件格式"}))
