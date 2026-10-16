import { useEffect, useState } from "react";
import { StorageFiles } from "./StorageFiles";
import { api } from "../api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Usage = {
  used_bytes: number;
  limit_bytes: number;
  categories: Record<string, number>;
};
function size(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function StorageUsage({ tick }: { tick: number }) {
  const [revision, setRevision] = useState(0);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    api<Usage>("/storage-usage")
      .then((value) => {
        if (current) {
          setUsage(value);
          setError(false);
        }
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [tick, revision]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>存储空间</CardTitle>
        <CardDescription>
          {usage
            ? `已用 ${size(usage.used_bytes)} / ${size(usage.limit_bytes)}`
            : "读取中…"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert>
            <AlertDescription>
              暂时无法读取存储用量，请稍后刷新。
            </AlertDescription>
          </Alert>
        ) : (
          usage && (
            <p className="text-sm text-muted-foreground">
              论文附件 {size(usage.categories.papers)} · 笔记图片{" "}
              {size(usage.categories.note_images)} · 聊天附件{" "}
              {size(usage.categories.chat_attachments)} · 手写批注{" "}
              {size(usage.categories.handwriting || 0)} · 文本批注{" "}
              {size(usage.categories.text_annotations || 0)}
            </p>
          )
        )}
      </CardContent>
      <CardFooter>
        <StorageFiles onChange={() => setRevision((value) => value + 1)} />
      </CardFooter>
    </Card>
  );
}
