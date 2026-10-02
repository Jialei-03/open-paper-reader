# TeX image used to compile translated arXiv sources (TRANSLATION_TEX_IMAGE).
#   docker build -t paper-tex:2026-09 -f deploy/translation/Dockerfile deploy/translation
# Behind a slow link, pass a nearer package mirror host: --build-arg APT_MIRROR=mirrors.example.com
FROM debian:bookworm-slim
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    latexmk texlive-xetex texlive-latex-extra texlive-science texlive-fonts-extra \
    texlive-lang-chinese fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends texlive-fonts-recommended tex-gyre texlive-plain-generic && rm -rf /var/lib/apt/lists/*
WORKDIR /work
