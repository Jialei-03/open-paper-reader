# TeX image used to compile translated arXiv sources (TRANSLATION_TEX_IMAGE).
#   docker build -t paper-tex:2026-10-fonts-v4 -f deploy/translation/Dockerfile deploy/translation
# Behind a slow link, pass a nearer package mirror host: --build-arg APT_MIRROR=mirrors.example.com
FROM debian:bookworm-slim
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    latexmk texlive-xetex texlive-latex-extra texlive-science texlive-fonts-extra \
    texlive-lang-chinese texlive-lang-other texlive-lang-european texlive-humanities fonts-noto-cjk lmodern fonts-font-awesome fonts-linuxlibertine fontconfig && rm -rf /var/lib/apt/lists/*
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends texlive-fonts-recommended tex-gyre texlive-plain-generic && rm -rf /var/lib/apt/lists/*
RUN fc-cache -f && mktexlsr
WORKDIR /work
