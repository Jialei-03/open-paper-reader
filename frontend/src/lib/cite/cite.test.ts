import { describe, expect, it } from "vitest";
import type { Paper } from "../../api";
import {
  citeRecord,
  formatApa,
  formatBibtex,
  formatBibtexFile,
  formatGbt,
  type CiteRecord,
} from "./index";

const TODAY = new Date(2026, 9, 19);

const conference: CiteRecord = {
  title: "Attention is all you need",
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
  year: 2017,
  venue: "Advances in Neural Information Processing Systems",
  kind: "conference",
  volume: "",
  issue: "",
  pages: "5998-6008",
  doi: "",
  arxiv: "1706.03762",
  url: "https://arxiv.org/abs/1706.03762",
};
const journal: CiteRecord = {
  title: "Deep learning",
  authors: ["Yann LeCun", "Yoshua Bengio", "Geoffrey E. Hinton"],
  year: 2015,
  venue: "Nature",
  kind: "journal",
  volume: "521",
  issue: "7553",
  pages: "436–444",
  doi: "10.1038/nature14539",
  arxiv: "",
  url: "",
};
const preprint: CiteRecord = {
  ...conference,
  venue: "",
  kind: "preprint",
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  pages: "",
};

describe("GB/T 7714", () => {
  it("formats a journal article", () => {
    expect(formatGbt(journal, TODAY)).toBe(
      "LECUN Y, BENGIO Y, HINTON G E. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.",
    );
  });
  it("formats a conference paper and cuts long author lists", () => {
    expect(formatGbt(conference, TODAY)).toBe(
      "VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]//Advances in Neural Information Processing Systems, 2017: 5998-6008.",
    );
  });
  it("formats a preprint as an online document with its access date", () => {
    expect(formatGbt(preprint, TODAY)).toBe(
      "VASWANI A, SHAZEER N. Attention is all you need[EB/OL]. (2017)[2026-10-19]. https://arxiv.org/abs/1706.03762.",
    );
  });
  it("keeps Chinese names whole and says 等", () => {
    const text = formatGbt(
      {
        ...journal,
        title: "深度学习综述",
        authors: ["张三", "李四", "王五", "赵六"],
        venue: "计算机学报",
        volume: "12",
        issue: "",
        doi: "",
      },
      TODAY,
    );
    expect(text).toBe(
      "张三, 李四, 王五, 等. 深度学习综述[J]. 计算机学报, 2015, 12: 436-444.",
    );
  });
});

describe("APA", () => {
  it("formats a journal article", () => {
    expect(formatApa(journal)).toBe(
      "LeCun, Y., Bengio, Y., & Hinton, G. E. (2015). Deep learning. Nature, 521(7553), 436\u2013444. https://doi.org/10.1038/nature14539",
    );
  });
  it("formats a conference paper", () => {
    expect(formatApa(conference)).toBe(
      "Vaswani, A., Shazeer, N., Parmar, N., & Uszkoreit, J. (2017). Attention is all you need. In Advances in Neural Information Processing Systems (pp. 5998\u20136008). https://arxiv.org/abs/1706.03762",
    );
  });
  it("formats a preprint", () => {
    expect(formatApa(preprint)).toBe(
      "Vaswani, A., & Shazeer, N. (2017). Attention is all you need. arXiv:1706.03762. https://arxiv.org/abs/1706.03762",
    );
  });
});

describe("BibTeX", () => {
  it("writes an article", () => {
    expect(formatBibtex(journal)).toBe(`@article{lecun2015deep,
  title = {{Deep learning}},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey E.},
  journal = {Nature},
  year = {2015},
  volume = {521},
  number = {7553},
  pages = {436--444},
  doi = {10.1038/nature14539}
}`);
  });
  it("writes proceedings and arXiv preprints", () => {
    expect(formatBibtex(conference)).toContain(
      "@inproceedings{vaswani2017attention,",
    );
    expect(formatBibtex(conference)).toContain(
      "booktitle = {Advances in Neural Information Processing Systems}",
    );
    const text = formatBibtex(preprint);
    expect(text).toContain("@misc{");
    expect(text).toContain("eprint = {1706.03762}");
    expect(text).toContain("archivePrefix = {arXiv}");
  });
  it("escapes markup and keeps keys apart", () => {
    const odd = { ...journal, title: "R&D at 50% _off_" };
    expect(formatBibtex(odd)).toContain("{{R\\&D at 50\\% \\_off\\_}}");
    const file = formatBibtexFile([journal, journal]);
    expect(file).toContain("@article{lecun2015deep,");
    expect(file).toContain("@article{lecun2015deepa,");
  });
});

describe("citeRecord", () => {
  const paper = {
    title: "Attention Is All You Need",
    authors: "Ashish Vaswani, Noam Shazeer",
    external_id: "arxiv:1706.03762v5",
  } as Paper;
  it("works from the paper alone", () => {
    const record = citeRecord(paper);
    expect(record.kind).toBe("preprint");
    expect(record.arxiv).toBe("1706.03762");
    expect(record.year).toBe(2017);
  });
  it("takes venue and year from the public record", () => {
    const record = citeRecord(paper, {
      paper_id: "p",
      status: "ok",
      venue: "NeurIPS",
      kind: "conference",
      year: 2017,
      pages: "1-2",
    });
    expect(record).toMatchObject({
      venue: "NeurIPS",
      kind: "conference",
      pages: "1-2",
    });
  });
});
