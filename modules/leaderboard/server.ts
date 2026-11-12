// Leaderboard HTTP and the half-hour refresh. The poller and its last verified snapshot live in this
// folder; the snapshot the site serves is the copy under AIHOT_DATA_DIR, shared by the api and the worker.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineServerModule } from "@aihot/backend/modules";
import { topicMarks } from "./marks.ts";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
  return process.env.AIHOT_DATA_DIR || join(here, "data");
}

function ensureSeed(): void {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "model-ranks.json");
  if (!existsSync(dest)) copyFileSync(join(here, "seed", "model-ranks.json"), dest);
}

ensureSeed();

const engine = require("./model-rank.cjs") as {
  readCache: () => CacheFile;
  refresh: () => Promise<CacheFile>;
};

type Any = Record<string, unknown>;

interface CacheFile {
  ok?: boolean;
  lastError?: unknown;
  payload?: Any | null;
}

function asRecord(value: unknown): Any {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Any) : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The rank file stores a failure as `{ at, message }`. The page only reads a string. */
function errorMessage(value: unknown): string | null {
  const direct = str(value);
  if (direct) return direct;
  const row = asRecord(value);
  return str(row.message);
}

function readFile(): CacheFile {
  ensureSeed();
  return engine.readCache();
}

interface SlimModel {
  slug: string;
  name: string;
  org: string | null;
  releasedOn: string | null;
  prices: { cache: number | null; input: number | null; output: number | null };
  evidenceLabel: string | null;
  evidenceNote: string | null;
  score: number | null;
  rank: number | null;
  consensus: number | null;
}

function slim(model: Any, boardId: string, index: number): SlimModel {
  const scores = asRecord(model.scores);
  const ranks = asRecord(model.ranks);
  const consensus = asRecord(model.consensus);
  const prices = asRecord(model.prices);
  const rank = num(ranks[boardId]);
  return {
    slug: str(model.slug) ?? "",
    name: str(model.name) ?? str(model.slug) ?? "",
    org: str(model.org),
    releasedOn: str(model.releasedOn),
    prices: { cache: num(prices.cache), input: num(prices.input), output: num(prices.output) },
    evidenceLabel: str(model.evidenceLabel),
    evidenceNote: str(model.evidenceNote),
    score: num(scores[boardId]),
    rank: rank ?? index + 1,
    consensus: num(consensus[boardId]),
  };
}

function sourcesOf(payload: Any): Array<{ label: string; url: string }> {
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  return sources.flatMap((item) => {
    const row = asRecord(item);
    const label = str(row.label);
    const url = str(row.url);
    return label && url ? [{ label, url }] : [];
  });
}

function listPayload() {
  const file = readFile();
  const payload = asRecord(file.payload);
  const models = asRecord(payload.models);
  const boards = Array.isArray(payload.boards) ? payload.boards : [];
  return {
    ok: file.ok !== false,
    lastError: errorMessage(file.lastError),
    checkedAt: str(payload.checkedAt),
    footnote: str(payload.footnote),
    fxRate: num(payload.fxRate),
    fxDate: str(payload.fxDate),
    sources: sourcesOf(payload),
    boards: boards.flatMap((item) => {
      const board = asRecord(item);
      const id = str(board.id);
      const label = str(board.label);
      if (!id || !label) return [];
      const slugs = Array.isArray(board.models) ? board.models : [];
      const rows = slugs.flatMap((slug, index) => {
        if (typeof slug !== "string") return [];
        const model = asRecord(models[slug]);
        if (!str(model.slug) && !str(model.name)) return [];
        return [slim(model, id, index)];
      });
      return [{ id, label, models: rows }];
    }),
  };
}

function profileOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    const label = str(row.label);
    if (!label) return [];
    return [{
      label,
      href: str(row.href),
      rankLabel: str(row.rankLabel),
      score: num(row.score),
      note: str(row.note),
      unmeasured: row.unmeasured === true,
    }];
  });
}

function behindOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    const title = str(row.title);
    if (!title) return [];
    const records = Array.isArray(row.records) ? row.records : [];
    return [{
      title,
      records: records.flatMap((record) => {
        const cell = asRecord(record);
        const name = str(cell.name);
        if (!name) return [];
        return [{ name, raw: str(cell.raw), role: str(cell.role), note: str(cell.note) }];
      }),
    }];
  });
}

function understandingOf(value: unknown) {
  const row = asRecord(value);
  const title = str(row.title);
  const summary = str(row.summary);
  if (!title && !summary) return null;
  const pairs = Array.isArray(row.pairs) ? row.pairs : [];
  return {
    title,
    summary,
    rangeLabel: str(row.rangeLabel),
    range: str(row.range),
    note: str(row.note),
    pairs: pairs.slice(0, 6).flatMap((item) => {
      const pair = asRecord(item);
      const opponent = str(pair.opponent);
      if (!opponent) return [];
      return [{ opponent, verdict: str(pair.verdict), note: str(pair.note) }];
    }),
  };
}

function detailPayload(slug: string) {
  const file = readFile();
  const payload = asRecord(file.payload);
  const model = asRecord(asRecord(payload.models)[slug]);
  if (!str(model.slug)) return null;
  const prices = asRecord(model.prices);
  return {
    ok: file.ok !== false,
    lastError: errorMessage(file.lastError),
    checkedAt: str(payload.checkedAt),
    footnote: str(payload.footnote),
    fxRate: num(payload.fxRate),
    fxDate: str(payload.fxDate),
    sources: sourcesOf(payload),
    model: {
      slug: str(model.slug) ?? slug,
      name: str(model.name) ?? slug,
      org: str(model.org),
      releasedOn: str(model.releasedOn),
      url: str(model.url),
      officialUrl: str(model.officialUrl),
      officialLabel: str(model.officialLabel),
      priceSource: str(model.priceSource),
      prices: { cache: num(prices.cache), input: num(prices.input), output: num(prices.output) },
      evidenceLabel: str(model.evidenceLabel),
      evidenceNote: str(model.evidenceNote),
      scores: {
        overall: num(asRecord(model.scores).overall),
        coding: num(asRecord(model.scores).coding),
        reasoning: num(asRecord(model.scores).reasoning),
        professional: num(asRecord(model.scores).professional),
      },
      ranks: {
        overall: num(asRecord(model.ranks).overall),
        coding: num(asRecord(model.ranks).coding),
        reasoning: num(asRecord(model.ranks).reasoning),
        professional: num(asRecord(model.ranks).professional),
      },
      capabilityProfile: profileOf(model.capabilityProfile),
      rankUnderstanding: understandingOf(model.rankUnderstanding),
      behindTheScore: behindOf(model.behindTheScore),
    },
  };
}

export const leaderboardModule = defineServerModule({
  name: "leaderboard",
  http(app) {
    app.get("/api/site/leaderboard", async (_req, reply) => {
      reply.header("Cache-Control", "public, max-age=60");
      return listPayload();
    });
    app.get<{ Params: { slug: string } }>("/api/site/leaderboard/:slug", async (req, reply) => {
      const detail = detailPayload(req.params.slug);
      if (!detail) return reply.code(404).send({ message: "not_found" });
      reply.header("Cache-Control", "public, max-age=60");
      return detail;
    });
  },
  schedules: [
    {
      name: "leaderboard.refresh",
      cron: "*/30 * * * *",
      missed: "once",
      run: () => engine.refresh(),
    },
  ],
  topics: {
    marks: async () => topicMarks(),
  },
});
