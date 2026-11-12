export interface Mark {
  src: string;
  monogram: string;
  raster: boolean;
}

interface MarkFile {
  file: string;
  monogram: string;
  dark?: boolean;
  raster?: boolean;
}

/** Company marks served as static files. A white drawing sits on a dark plate. */
export const MARK_FILES: Record<string, MarkFile> = {
  openai: { file: "openai.svg", monogram: "O" },
  anthropic: { file: "anthropic.svg", monogram: "A" },
  google: { file: "google.svg", monogram: "G" },
  deepseek: { file: "deepseek.svg", monogram: "D" },
  qwen: { file: "qianwen.svg", monogram: "千" },
  kimi: { file: "moonshot.svg", monogram: "K", dark: true },
  minimax: { file: "minimax.svg", monogram: "M" },
  zhipu: { file: "z-ai.svg", monogram: "智" },
  xai: { file: "xai.svg", monogram: "X" },
  meta: { file: "meta.svg", monogram: "M" },
  microsoft: { file: "/marks/press/microsoft.png", monogram: "M", raster: true },
  nvidia: { file: "nvidia.svg", monogram: "N" },
  "hugging-face": { file: "huggingface.svg", monogram: "H" },
  cursor: { file: "cursor.svg", monogram: "C" },
  openrouter: { file: "openrouter.svg", monogram: "O" },
  mistral: { file: "mistral.svg", monogram: "M" },
  xiaomi: { file: "xiaomi-mimo.svg", monogram: "X" },
};

const ORG_SLUG: Record<string, string> = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Google: "google",
  DeepSeek: "deepseek",
  Alibaba: "qwen",
  Kimi: "kimi",
  Meta: "meta",
  Mistral: "mistral",
  MiniMax: "minimax",
  SpaceXAI: "xai",
  xAI: "xai",
  Xiaomi: "xiaomi",
  "Z AI": "zhipu",
};

export function brandForSlug(slug: string): Mark | null {
  const mark = MARK_FILES[slug];
  if (!mark) return null;
  return {
    src: mark.file.startsWith("/") ? mark.file : `/marks/${mark.file}`,
    monogram: mark.monogram,
    raster: mark.raster ?? false,
  };
}

export function brandForOrg(org: string | null | undefined): Mark | null {
  if (!org) return null;
  return brandForSlug(ORG_SLUG[org] ?? "");
}

export function topicMarks(): Record<string, Mark> {
  return Object.fromEntries(
    Object.keys(MARK_FILES).flatMap((slug) => {
      const brand = brandForSlug(slug);
      return brand ? [[slug, brand]] : [];
    }),
  );
}

export const DARK_MARKS = Object.values(MARK_FILES)
  .filter((mark) => mark.dark)
  .map((mark) => (mark.file.startsWith("/") ? mark.file : `/marks/${mark.file}`));
