import { Link, useLoaderData } from "react-router";
import { BrandMark } from "../../../apps/web/app/components/BrandMark";
import { IconArrowLeft, IconArrowUpRight } from "../../../apps/web/app/components/icons";
import { brandForOrg } from "../marks";
import { PhoneBar } from "../../../apps/web/app/components/shell/PhoneBar";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import { cachedPage, loadOr404, pageHeaders } from "../../../apps/web/app/lib/api.server";
import { monthDayTime } from "../../../apps/web/app/lib/format";
import { pageReuse } from "../../../apps/web/app/lib/page-reuse";
import { pageMeta } from "../../../apps/web/app/lib/seo";

export const handle: Screen = { tab: "me", name: "模型" };

interface Detail {
  ok: boolean;
  lastError: string | null;
  checkedAt: string | null;
  footnote: string | null;
  fxRate: number | null;
  fxDate: string | null;
  sources: Array<{ label: string; url: string }>;
  model: {
    slug: string;
    name: string;
    org: string | null;
    releasedOn: string | null;
    url: string | null;
    officialUrl: string | null;
    officialLabel: string | null;
    priceSource: string | null;
    prices: { cache: number | null; input: number | null; output: number | null };
    evidenceLabel: string | null;
    evidenceNote: string | null;
    scores: { overall: number | null; coding: number | null; reasoning: number | null; professional: number | null };
    ranks: { overall: number | null; coding: number | null; reasoning: number | null; professional: number | null };
    capabilityProfile: Array<{ label: string; href: string | null; rankLabel: string | null; score: number | null; note: string | null; unmeasured: boolean }>;
    rankUnderstanding: {
      title: string | null;
      summary: string | null;
      rangeLabel: string | null;
      range: string | null;
      note: string | null;
      pairs: Array<{ opponent: string; verdict: string | null; note: string | null }>;
    } | null;
    behindTheScore: Array<{ title: string; records: Array<{ name: string; raw: string | null; role: string | null; note: string | null }> }>;
  };
}

const BOARDS = [
  { id: "overall", label: "综合" },
  { id: "coding", label: "编程" },
  { id: "reasoning", label: "推理" },
  { id: "professional", label: "专业办公" },
] as const;

export async function loader({ request, params }: { request: Request; params: { slug?: string } }) {
  const detail = await loadOr404<Detail>(`/api/site/leaderboard/${encodeURIComponent(params.slug ?? "")}`, { signal: request.signal });
  return cachedPage(60, { detail });
}

export const headers = pageHeaders;
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export function meta({ loaderData }: { loaderData?: { detail?: Detail } }) {
  const name = loaderData?.detail?.model.name ?? "模型";
  return pageMeta({ title: name, description: `${name} 在公开测评里的分数、报价和分项。`, path: `/leaderboard/${loaderData?.detail?.model.slug ?? ""}` });
}

function money(value: number | null): string | null {
  if (value == null) return null;
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function points(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function ModelDetailPage() {
  const { detail } = useLoaderData<typeof loader>();
  const model = detail.model;
  const brand = brandForOrg(model.org);
  const listed = BOARDS.filter((board) => model.scores[board.id] != null).length;
  const measured = model.capabilityProfile.filter((item) => !item.unmeasured && item.score != null).length;
  const input = money(model.prices.input);
  const output = money(model.prices.output);
  const cache = money(model.prices.cache);
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/leaderboard", label: "模型榜" }} title={model.name} />
      <Link to="/leaderboard" className="hidden items-center gap-1 text-[13px] text-ink-3 transition-colors hover:text-ink lg:inline-flex">
        <IconArrowLeft size={14} /> 返回模型榜
      </Link>

      <header className="mt-3 flex flex-col gap-5 pb-7 sm:flex-row sm:items-end sm:justify-between lg:mt-5">
        <div className="flex items-center gap-4">
          {brand && <BrandMark brand={brand} size={52} />}
          <div className="min-w-0">
            <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink">{model.name}</h1>
            <p className="num mt-1 text-[12.5px] text-ink-3">
              {model.org ?? "机构未标明"}
              {model.releasedOn ? <> · {model.releasedOn} 上线</> : null}
              {detail.checkedAt ? <> · {monthDayTime(detail.checkedAt)} 核验</> : null}
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          <span className="block text-[12px] text-ink-4">公示分数 · 综合</span>
          <strong className="mono block text-[38px] font-medium leading-[1.4] tracking-[-0.035em] text-accent lg:text-[44px]">
            {points(model.scores.overall)}
            {model.scores.overall != null && <span className="ml-1 text-[14px] font-normal text-ink-4">分</span>}
          </strong>
          <span className="block text-[13px] text-ink-2">{model.ranks.overall != null ? `综合第 ${model.ranks.overall} 名` : "综合未入榜"}</span>
          {model.evidenceLabel && <span className="block text-[12px] text-ink-3" title={model.evidenceNote ?? undefined}>{model.evidenceLabel}</span>}
        </div>
      </header>

      {!detail.ok && <p className="mb-4 text-[12px] text-amber-ink">上次核验没有完成，下面仍是上次记下的分数。</p>}

      <section className="grid grid-cols-2 gap-x-4 gap-y-6 border-y border-line py-6 lg:grid-cols-4" aria-label="模型概览">
        <Stat label="入榜分类" value={String(listed)} hint={`/ ${BOARDS.length} 项分类`} />
        <Stat label="已有分项" value={measured > 0 ? String(measured) : "—"} hint={measured > 0 ? "项公示" : undefined} />
        <Stat label="评测证据" value={model.evidenceLabel ?? "—"} compact />
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] text-ink-4">API 输入 / 输出 · 每百万 Token</span>
          <span className="mono mt-2 text-[20px] font-semibold leading-tight text-ink">
            {input && output ? `${input} / ${output}` : "待核验"}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ink-3">
            <span className="num">{cache ? `缓存 ${cache}` : "缓存待核验"}</span>
            {model.officialUrl && (
              <a href={model.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:text-accent-ink">
                {model.officialLabel ?? "厂商页"} <IconArrowUpRight size={12} />
              </a>
            )}
          </span>
        </div>
      </section>

      <section className="mt-12">
        <span className="mono text-[11px] font-semibold tracking-[0.14em] text-accent">CAPABILITY PROFILE</span>
        <h2 className="mt-2 text-[20px] font-bold leading-[1.5] text-ink">各榜分数，放在一起看。</h2>
        <p className="mt-1 max-w-[720px] text-[13px] text-ink-3">综合、编程、推理、专业办公分开列。分数是测评站已经公示的成绩，核不到的留空。</p>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {BOARDS.map((board) => (
            <div key={board.id} className="card flex h-full flex-col rounded-card p-4 lg:p-[22px]">
              <span className="text-[14px] font-semibold text-ink">{board.label}</span>
              <span className="mt-3 text-[11px] text-ink-4">公示分数</span>
              <span className="mono mt-1 text-[28px] font-medium leading-tight tracking-[-0.03em] text-ink">
                {points(model.scores[board.id])}
                {model.scores[board.id] != null && <span className="ml-1 text-[12px] text-ink-4">分</span>}
              </span>
              <span className="mt-1 text-[12px] text-ink-3">{model.ranks[board.id] != null ? `第 ${model.ranks[board.id]} 名` : "未入榜"}</span>
            </div>
          ))}
        </div>
      </section>

      {model.rankUnderstanding && (
        <section className="mt-12">
          <span className="mono text-[11px] font-semibold tracking-[0.14em] text-accent">UNDERSTANDING THE RANK</span>
          <h2 className="mt-2 text-[20px] font-bold leading-[1.5] text-ink">{model.rankUnderstanding.title ?? "名次有多稳"}</h2>
          {model.rankUnderstanding.summary && <p className="mt-1 max-w-[720px] text-[13px] leading-[1.75] text-ink-3">{model.rankUnderstanding.summary}</p>}
          {model.rankUnderstanding.range && (
            <p className="mt-4 text-[13px] text-ink-3">
              {model.rankUnderstanding.rangeLabel ?? "去类后的名次范围"}
              <span className="ml-2 text-ink">{model.rankUnderstanding.range}</span>
            </p>
          )}
          {model.rankUnderstanding.note && <p className="mt-2 max-w-[720px] text-[12px] leading-relaxed text-ink-4">{model.rankUnderstanding.note}</p>}
          {model.rankUnderstanding.pairs.length > 0 && (
            <ul className="mt-4 space-y-2">
              {model.rankUnderstanding.pairs.map((pair) => (
                <li key={pair.opponent} className="card rounded-tile px-4 py-3 text-[13px] leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">{pair.opponent}</span>
                  {pair.verdict ? ` · ${pair.verdict}` : ""}
                  {pair.note ? <span className="text-ink-4"> · {pair.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(model.capabilityProfile.length > 0 || model.behindTheScore.length > 0) && (
        <section className="mt-12">
          <span className="mono text-[11px] font-semibold tracking-[0.14em] text-accent">BEHIND THE SCORE</span>
          <h2 className="mt-2 text-[20px] font-bold leading-[1.5] text-ink">每一项成绩，都有来处。</h2>
          <p className="mt-1 max-w-[720px] text-[13px] text-ink-3">下面是已核到的公示分项和原始数字。没有折算成另一种分数。</p>

          {model.capabilityProfile.length > 0 && (
            <div className="mt-6">
              <h3 className="flex items-baseline gap-2 text-[14px] font-semibold text-ink">
                已公示分项
                <span className="num text-[11.5px] font-normal text-ink-4">{measured} 项</span>
              </h3>
              <ul className="mt-2.5 space-y-2">
                {model.capabilityProfile.map((item) => (
                  <li key={item.label} className="card flex items-center gap-3.5 rounded-tile px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      {item.href ? (
                        <a href={item.href} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-semibold text-ink hover:text-accent">{item.label}</a>
                      ) : (
                        <span className="block truncate text-[13.5px] font-semibold text-ink">{item.label}</span>
                      )}
                      {item.note && <small className="text-[11px] text-ink-4">{item.note}</small>}
                    </div>
                    <div className="text-right">
                      <span className="mono block text-[19px] font-medium leading-tight text-ink">{item.unmeasured ? "未测" : points(item.score)}</span>
                      {item.rankLabel && <span className="block text-[11px] text-ink-3">{item.rankLabel}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {model.behindTheScore.map((block) => (
            <div key={block.title} className="mt-6">
              <h3 className="text-[14px] font-semibold text-ink">{block.title}</h3>
              <ul className="mt-2.5 space-y-2">
                {block.records.map((record) => (
                  <li key={record.name} className="card flex items-center gap-3.5 rounded-tile px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{record.name}</span>
                      {(record.role || record.note) && <small className="text-[11px] text-ink-4">{[record.role, record.note].filter(Boolean).join(" · ")}</small>}
                    </div>
                    <span className="mono shrink-0 text-[16px] font-medium text-ink">{record.raw ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className="mt-10 max-w-[760px] text-[12px] leading-[1.75] text-ink-4">
        {model.priceSource ? `${model.priceSource} ` : ""}
        {detail.fxRate != null ? `美元按 Frankfurter${detail.fxDate ? ` ${detail.fxDate}` : ""} 汇率 1 美元 ≈ ${detail.fxRate} 人民币折算，不是厂商官网人民币价。` : ""}
        {detail.footnote ? ` ${detail.footnote}` : " 数字和原话请回测评站核对。"}
      </p>
      {(model.url || detail.sources.length > 0) && (
        <p className="mt-2 text-[13px] text-ink-3">
          来源
          {model.url && <a href={model.url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:text-accent-ink">测评页</a>}
          {detail.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:text-accent-ink">{source.label}</a>
          ))}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint, compact = false }: { label: string; value: string; hint?: string; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] text-ink-4">{label}</span>
      <span className={`mt-2 font-semibold leading-tight text-ink ${compact ? "text-[15px]" : "mono text-[20px]"}`}>
        {value}
        {hint && <small className="ml-1 font-sans text-[11px] font-normal text-ink-4">{hint}</small>}
      </span>
    </div>
  );
}
