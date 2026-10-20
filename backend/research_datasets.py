"""The data a project's experiments use, fetched by the system and pinned by hash.

Experiments have no network, so a public dataset is downloaded here, on the
host, when the researcher picks it for a project; it is checked against the
checksums its publisher gives, kept once for all projects, and mounted
read-only at /data/<name>. Files the researcher uploads are recorded with
their own hashes. Either way the record says exactly which bytes a result
came from.
"""

import hashlib
import shutil
import urllib.request
from pathlib import Path

from sqlalchemy import select

from .models import ResearchDataset

# Publisher checksums (md5, as published) for the files of each dataset.
REGISTRY = {
    "mnist": {
        "title": "MNIST 手写数字（6 万训练 / 1 万测试，28×28 灰度）",
        "files": [
            (
                "train-images-idx3-ubyte.gz",
                "https://ossci-datasets.s3.amazonaws.com/mnist/train-images-idx3-ubyte.gz",
                "f68b3c2dcbeaaa9fbdd348bbdeb94873",
            ),
            (
                "train-labels-idx1-ubyte.gz",
                "https://ossci-datasets.s3.amazonaws.com/mnist/train-labels-idx1-ubyte.gz",
                "d53e105ee54ea40749a09fcbcd1e9432",
            ),
            (
                "t10k-images-idx3-ubyte.gz",
                "https://ossci-datasets.s3.amazonaws.com/mnist/t10k-images-idx3-ubyte.gz",
                "9fb629c4189551a2d022fa330f9573f3",
            ),
            (
                "t10k-labels-idx1-ubyte.gz",
                "https://ossci-datasets.s3.amazonaws.com/mnist/t10k-labels-idx1-ubyte.gz",
                "ec29112dd5afa0611ce80d1b7f02629c",
            ),
        ],
    },
    "cifar-10": {
        "title": "CIFAR-10（5 万训练 / 1 万测试，32×32 彩色，10 类）",
        "files": [
            (
                "cifar-10-python.tar.gz",
                "https://www.cs.toronto.edu/~kriz/cifar-10-python.tar.gz",
                "c58f30108f718f92721af3b95e74349a",
            ),
        ],
    },
}
CHUNK = 1024 * 1024
# Through one name, so tests can stand in for the network.
urlopen = urllib.request.urlopen


def catalog():
    return [{"name": k, "title": v["title"]} for k, v in REGISTRY.items()]


def cache(settings):
    path = Path(settings.storage).parent / "research" / "datasets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _hashes(path):
    md5, sha = hashlib.md5(), hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(CHUNK):
            md5.update(block)
            sha.update(block)
    return md5.hexdigest(), sha.hexdigest()


def request(d, project, names):
    """Records the datasets a project will use; the worker fetches them."""
    for name in names:
        if name not in REGISTRY:
            raise ValueError(f"不认识的数据集：{name}")
        d.add(
            ResearchDataset(
                project_id=project.id,
                name=name,
                source="registry",
                path=f"/data/{name}",
            )
        )


def fetch(settings, row):
    """Downloads (or reuses) one registry dataset and verifies every file."""
    spec = REGISTRY[row.name]
    folder = cache(settings) / row.name
    folder.mkdir(exist_ok=True)
    files = []
    for name, url, md5 in spec["files"]:
        target = folder / name
        if not target.exists() or _hashes(target)[0] != md5:
            partial = target.with_suffix(target.suffix + ".part")
            with urlopen(url, timeout=60) as response, partial.open("wb") as out:
                shutil.copyfileobj(response, out, CHUNK)
            partial.replace(target)
        got_md5, sha = _hashes(target)
        if got_md5 != md5:
            target.unlink(missing_ok=True)
            raise ValueError(f"{name} 校验不符（期望 md5 {md5}，得到 {got_md5}）")
        files.append(
            {"name": name, "bytes": target.stat().st_size, "md5": md5, "sha256": sha}
        )
    row.files = files
    row.bytes = sum(f["bytes"] for f in files)
    row.status = "ready"
    row.note = url.split("/")[2]


def fetch_pending(settings, maker):
    """Fetches what projects asked for; a failure is written down, not retried in a loop."""
    with maker() as d:
        ids = list(
            d.scalars(
                select(ResearchDataset.id).where(ResearchDataset.status == "pending")
            )
        )
    for id in ids:
        with maker() as d:
            row = d.get(ResearchDataset, id)
            try:
                fetch(settings, row)
            except (OSError, ValueError) as e:
                row.status = "failed"
                row.note = str(e)[:500]
            d.commit()


def ready(d, project):
    return list(
        d.scalars(
            select(ResearchDataset).where(
                ResearchDataset.project_id == project.id,
                ResearchDataset.status == "ready",
                ResearchDataset.source == "registry",
            )
        )
    )


def pending(d, project):
    return d.scalars(
        select(ResearchDataset).where(
            ResearchDataset.project_id == project.id,
            ResearchDataset.status == "pending",
        )
    ).first()


def record_upload(d, project, path, data):
    """An uploaded file, under /work/data, with the hash of what was received."""
    d.add(
        ResearchDataset(
            project_id=project.id,
            name=Path(path).name[:100],
            source="upload",
            path="/work/" + path,
            status="ready",
            files=[
                {
                    "name": Path(path).name,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            ],
            bytes=len(data),
        )
    )


def of(d, project_id):
    return list(
        d.scalars(
            select(ResearchDataset)
            .where(ResearchDataset.project_id == project_id)
            .order_by(ResearchDataset.created_at)
        )
    )


def out(row):
    return {
        k: getattr(row, k)
        for k in (
            "id",
            "name",
            "source",
            "path",
            "status",
            "files",
            "bytes",
            "note",
            "created_at",
        )
    } | {"title": REGISTRY.get(row.name, {}).get("title", "")}
