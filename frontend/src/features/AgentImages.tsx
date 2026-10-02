import { useState } from "react";
import {
  Attachment,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type AgentImage = {
  url: string;
  label: string;
  paper_id: string | null;
  width: number;
  height: number;
};
export function AgentImages({
  images,
  delivered,
}: {
  images: AgentImage[];
  delivered?: boolean;
}) {
  const [selected, setSelected] = useState<AgentImage | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  // Only backend-generated, authenticated previews. Never load model-supplied remote images.
  const safe = images
    .filter((image) =>
      /^\/api\/v1\/agent\/files\/[0-9a-f-]{36}\/image\?/.test(image.url),
    )
    .map((image) => ({
      ...image,
      // Older saved tool receipts labelled ordinary uploaded images as page 1.
      label: image.label.replace(
        /(\.(?:png|jpe?g|webp|gif)) · 第 1 页(?= · 选区|$)/i,
        "$1",
      ),
    }));
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {safe.map((image) => (
          <Attachment
            key={image.url}
            className="w-full max-w-80 flex-col overflow-hidden"
            state={failed[image.url] ? "error" : "done"}
          >
            {failed[image.url] ? (
              <p className="p-3 text-sm">
                图片加载失败，点击重试或重新读取附件。
              </p>
            ) : (
              <img
                src={image.url}
                alt={image.label}
                loading="lazy"
                width={image.width}
                height={image.height}
                className="max-h-56 w-full object-contain"
                onError={() => setFailed((v) => ({ ...v, [image.url]: true }))}
              />
            )}
            <AttachmentContent className="w-full p-3">
              <AttachmentTitle title={image.label}>
                {image.label}
              </AttachmentTitle>
              <AttachmentDescription>
                {delivered
                  ? "已传给视觉模型 · 点击放大"
                  : "仅展示 · 未传给模型"}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger
              aria-label={`放大图片：${image.label}`}
              onClick={() => {
                setFailed((v) => ({ ...v, [image.url]: false }));
                setSelected(image);
              }}
            />
          </Attachment>
        ))}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selected?.label}</DialogTitle>
            <DialogDescription>附件预览</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="max-h-[70dvh] overflow-auto">
                <img
                  src={selected.url}
                  alt={selected.label}
                  width={selected.width}
                  height={selected.height}
                  className="mx-auto h-auto max-w-full"
                />
              </div>
              {selected.paper_id && (
                <Button variant="outline" asChild>
                  <a
                    href={`#paper/${selected.paper_id}`}
                    onClick={() => setSelected(null)}
                  >
                    打开论文
                  </a>
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
