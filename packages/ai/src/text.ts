/** Lightweight Indonesian text normalisation used by the mock embedder and keyword rules. */
const STOPWORDS = new Set(
  "yang di ke dari dan atau untuk dengan pada ini itu apa apakah bagaimana gimana kapan berapa saya aku kami kita anda kak kakak min admin mohon tolong bisa dong ya ga gak tidak sudah belum ada adalah akan jika kalau juga lagi saja aja nya the".split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Very small suffix stripper (particles/possessives), not a full Indonesian stemmer. */
function stem(word: string): string {
  return word.replace(/(nya|kah|lah|pun)$/u, "") || word;
}

export function tokenize(text: string, { keepStopwords = false } = {}): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length > 1 && (keepStopwords || !STOPWORDS.has(w)))
    .map(stem);
}
