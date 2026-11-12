import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { BrandMark } from "../../../apps/web/app/components/BrandMark";
import { IconArrowUpRight, IconInfo } from "../../../apps/web/app/components/icons";
import { brandForOrg } from "../marks";
import { EmptyState } from "../../../apps/web/app/components/ui/Page";
import { PillTabs } from "../../../apps/web/app/components/ui/Tabs";
import { PhoneBar } from "../../../apps/web/app/components/shell/PhoneBar";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import { cachedPage, loadOr404, pageHeaders } from "../../../apps/web/app/lib/api.server";
import { monthDayTime } from "../../../apps/web/app/lib/format";
import { pageReuse } from "../../../apps/web/app/lib/page-reuse";
import { pageMeta } from "../../../apps/web/app/lib/seo";

export const handle: Screen = { tab: "me", name: "模型榜" };

interface Prices {
  cache: number | null;
  input: number | null;
  output: number | null;
}

interface RankRow {
  slug: string;
  name: string;
  org: string | null;
  releasedOn: string | null;
  prices: Prices;
  evidenceLabel: string | null;
  evidenceNote: string | null;
  score: number | null;
  rank: number | null;
  consensus: number | null;
}

interface Board {
  id: string;
  label: string;
  models: RankRow[];
}

interface Leaderboard {
  ok: boolean;
  lastError: string | null;
  checkedAt: string | null;
  footnote: string | null;
  fxRate: number | null;
  fxDate: string | null;
  sources: Array<{ label: string; url: string }>;
  boards: Board[];
}

type SortKey = "rank" | "released" | "cache" | "input" | "output" | "score";

export async function loader({ request }: { request: Request }) {
  const board = await loadOr404<Leaderboard>("/api/site/leaderboard", { signal: request.signal });
  return cachedPage(60, { board });
}

export const headers = pageHeaders;
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export function meta() {
  return pageMeta({
    title: "模型榜",
    description: "主流测评站已公示的综合、编程、推理和专业办公分数，价格按当日汇率折成人民币。",
    path: "/leaderboard",
  });
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(month)}月${Number(day)}日`;
}

function points(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function sortValue(model: RankRow, key: SortKey): number | string | null {
  if (key === "rank") return model.rank;
  if (key === "released") return model.releasedOn;
  if (key === "score") return model.score;
  return model.prices[key];
}

function ordered(models: RankRow[], sort: { key: SortKey; dir: 1 | -1 }): RankRow[] {
  return [...models].sort((left, right) => {
    const a = sortValue(left, sort.key);
    const b = sortValue(right, sort.key);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (a < b) return -sort.dir;
    if (a > b) return sort.dir;
    return 0;
  });
}

function openingBoard(boards: Board[]): string {
  return boards.find((item) => item.models.length > 0)?.id ?? boards[0]?.id ?? "overall";
}

export default function LeaderboardPage() {
  const { board } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [active, setActive] = useState(() => openingBoard(board.boards));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const current = board.boards.find((item) => item.id === active) ?? board.boards[0];
  const models = current ? ordered(current.models, sort) : [];

  function pickBoard(id: string) {
    setActive(id);
    setSort({ key: "rank", dir: 1 });
  }

  function pickSort(key: SortKey) {
    setSort((currentSort) => {
      if (currentSort.key !== key) return { key, dir: key === "rank" || key === "released" ? 1 : -1 };
      return { key, dir: currentSort.dir === 1 ? -1 : 1 };
    });
  }

  return (
    <div className="pb-10">
      <PhoneBar
        title="模型榜"
        large
        sub={board.checkedAt ? <span className="num">{monthDayTime(board.checkedAt)} 核验</span> : "公开测评分数"}
      />
      <header className="hidden flex-col gap-3 pb-4 pt-1 sm:flex-row sm:items-end sm:justify-between lg:flex">
        <div>
          <div className="mono text-[11px] font-semibold tracking-[0.16em] text-accent">LEADERBOARD</div>
          <h1 data-page-title="" className="mt-1.5 text-[24px] font-semibold leading-[1.3] text-ink">AI 模型排行榜</h1>
        </div>
        <div className="flex gap-2">
          <a href="#rank-method" className="inline-flex h-8 items-center gap-1 rounded-full border border-line-strong bg-surface px-3.5 text-[12.5px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink">
            排序怎么算 <IconArrowUpRight size={13} />
          </a>
          <a href="#rank-price" className="inline-flex h-8 items-center gap-1 rounded-full border border-line-strong bg-surface px-3.5 text-[12.5px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink">
            关于价格 <IconArrowUpRight size={13} />
          </a>
        </div>
      </header>

      {board.boards.length > 0 && current && (
        <PillTabs
          layoutId="leaderboard-boards"
          label="榜单分类"
          active={current.id}
          onSelect={pickBoard}
          items={board.boards.map((item) => ({ key: item.id, label: item.label }))}
        />
      )}

      <div className="mt-3 flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-[13.5px] text-ink-2">综合、编程、推理、专业办公。只列测评站已经公示的分数和报价，核不到的留空。</p>
        <p className="num shrink-0 text-[12px] text-ink-4">
          {board.sources.length > 0 && <>{board.sources.length} 家来源<span className="mx-2">·</span></>}
          {board.checkedAt ? <><span>{monthDayTime(board.checkedAt)}</span> 核验</> : "等待核验"}
        </p>
      </div>

      {!board.ok && (
        <p className="mt-3 rounded-full bg-amber-soft px-3 py-1.5 text-[12px] text-amber-ink">
          上次核验没有完成，下面仍是上次记下的分数。{board.lastError ? ` ${board.lastError}` : ""}
        </p>
      )}

      {!current || models.length === 0 ? (
        <div className="card mt-3">
          <EmptyState title="暂时没有榜单">测评站这次没有给出可展示的分数。</EmptyState>
        </div>
      ) : (
        <section className="card mt-3 overflow-hidden" aria-label={`${current.label}榜`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 lg:px-[22px]">
            <h2 className="text-[16px] font-bold text-ink">
              {current.label}榜
              <span className="mono ml-2 text-[11px] font-normal tracking-wide text-ink-4">{models.length} 个模型</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[14px]">
              <thead>
                <tr className="border-y border-line text-ink-4">
                  <th scope="col" className="w-[72px] py-2.5 pl-4 pr-1 text-left font-medium lg:w-[86px] lg:pl-[22px] lg:pr-3">
                    <SortButton label="名次" active={sort.key === "rank"} dir={sort.dir} onClick={() => pickSort("rank")} />
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-left font-medium lg:px-3">模型</th>
                  <SortHead label="上线日期" sortKey="released" sort={sort} onSort={pickSort} className="hidden lg:table-cell lg:w-[11%]" />
                  <th scope="col" className="hidden px-3 py-2.5 text-left font-medium lg:table-cell lg:w-[16%]">评测证据</th>
                  <SortHead label="缓存价格" hint="人民币 / 百万 Token" sortKey="cache" sort={sort} onSort={pickSort} className="hidden lg:table-cell lg:w-[12%]" />
                  <SortHead label="输入价格" hint="人民币 / 百万 Token" sortKey="input" sort={sort} onSort={pickSort} className="hidden lg:table-cell lg:w-[12%]" />
                  <SortHead label="输出价格" hint="人民币 / 百万 Token" sortKey="output" sort={sort} onSort={pickSort} className="hidden lg:table-cell lg:w-[12%]" />
                  <th scope="col" className="w-[88px] py-2.5 pl-2 pr-4 text-right font-medium lg:w-[11%] lg:pl-3 lg:pr-[22px]">
                    <button
                      type="button"
                      title="综合榜按 Artificial Analysis Intelligence Index 排序。编程、推理、专业办公按 LiveBench 已公示任务等权平均。共识指数只在两家都给出可对照的 0–100 分时才计算。"
                      className={`inline-flex items-center gap-1 whitespace-nowrap ${sort.key === "score" ? "text-accent" : "text-ink-4 hover:text-ink"}`}
                      onClick={() => pickSort("score")}
                    >
                      分数
                      <IconInfo size={13} />
                      <SortMark active={sort.key === "score"} dir={sort.dir} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const brand = brandForOrg(model.org);
                  return (
                    <tr
                      key={model.slug}
                      className="group cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-accent-softer"
                      onClick={() => navigate(`/leaderboard/${model.slug}`)}
                    >
                      <td className="py-2.5 pl-4 pr-1 align-middle lg:py-3 lg:pl-[22px] lg:pr-3">
                        <span className="mono text-[13px] text-ink-4">{model.rank == null ? "—" : String(model.rank).padStart(2, "0")}</span>
                      </td>
                      <td className="px-2 py-2.5 lg:px-3 lg:py-3">
                        <span className="flex items-center gap-3">
                          {brand && <BrandMark brand={brand} size={32} />}
                          <span className="min-w-0">
                            <Link to={`/leaderboard/${model.slug}`} className="block" onClick={(event) => event.stopPropagation()}>
                              <strong className="text-[15px] font-semibold leading-[21px] text-ink transition-colors group-hover:text-accent">{model.name}</strong>
                            </Link>
                            <small className="hidden text-[12px] leading-[18px] text-ink-4 lg:block">{model.org ?? "机构未标明"}</small>
                            <small className="block truncate text-[12px] leading-[18px] text-ink-4 lg:hidden">
                              {model.org ?? "机构未标明"}
                              {model.releasedOn ? <> · <span className="num">{shortDay(model.releasedOn)}</span>上线</> : null}
                            </small>
                          </span>
                        </span>
                      </td>
                      <td className="mono hidden px-3 py-3 text-[12px] text-ink-3 lg:table-cell">{model.releasedOn ?? "—"}</td>
                      <td className="hidden px-3 py-3 lg:table-cell" title={model.evidenceNote ?? undefined}>
                        {model.evidenceLabel
                          ? <span className="block text-[13px] leading-snug text-ink-2">{model.evidenceLabel}</span>
                          : <span className="text-[13px] text-ink-4">—</span>}
                      </td>
                      <td className="hidden px-3 py-3 lg:table-cell"><Money value={model.prices.cache} /></td>
                      <td className="hidden px-3 py-3 lg:table-cell"><Money value={model.prices.input} /></td>
                      <td className="hidden px-3 py-3 lg:table-cell"><Money value={model.prices.output} /></td>
                      <td className="py-2.5 pl-2 pr-4 text-right align-middle lg:py-3 lg:pl-3 lg:pr-[22px]">
                        <strong className="mono block text-[22px] font-semibold leading-7 tracking-[-0.025em] text-accent">{points(model.score)}</strong>
                        {model.consensus != null && <small className="block text-[11px] leading-[17px] text-ink-4">共识 {points(model.consensus)}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ink-4 lg:px-[22px]">
            名次按这一榜已公示的分数排列，不设并列。点列名可以按已有数字重排，空着的字段留在最后。每次最多展示 30 个模型。
          </div>
        </section>
      )}

      <section id="rank-method" className="mt-8 scroll-mt-6">
        <h2 className="text-[18px] font-bold text-ink">如何看这张榜</h2>
        <p className="mt-2 max-w-[760px] text-[13.5px] leading-[1.75] text-ink-3">
          {board.footnote || "综合榜按 Artificial Analysis Intelligence Index 排序；编程、推理、专业办公按 LiveBench 对应分类的已公示任务等权平均。共识指数只在两家机构都给出可直接对照的 0–100 分时才等权计算，否则留空。"}
        </p>
      </section>
      <section id="rank-price" className="mt-6 scroll-mt-6">
        <h2 className="text-[18px] font-bold text-ink">关于价格</h2>
        <p className="mt-2 max-w-[760px] text-[13.5px] leading-[1.75] text-ink-3">
          价格是人民币 / 百万 token。美元报价按 Frankfurter{board.fxDate ? ` ${board.fxDate}` : ""}{board.fxRate != null ? `（1 美元 ≈ ${board.fxRate} 人民币）` : ""}折算，不是厂商官网人民币价。缓存价格指命中后的输入价格，缓存写入、存储和订阅另计。数字和原话请回测评站核对。
        </p>
        {board.sources.length > 0 && (
          <p className="mt-2 text-[13px] text-ink-3">
            来源
            {board.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:text-accent-ink">
                {source.label}
              </a>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}

function Money({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[13px] text-ink-4">待核验</span>;
  return <span className="mono text-[14.5px] font-medium text-ink">{formatMoney(value)}</span>;
}

function SortMark({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  return <span className={`text-[9px] ${active ? "opacity-100" : "opacity-0 group-hover/sort:opacity-40"}`} aria-hidden="true">{dir === 1 || !active ? "▲" : "▼"}</span>;
}

function SortButton({ label, active, dir, onClick }: { label: string; active: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <button type="button" className={`group/sort inline-flex items-start gap-1 whitespace-nowrap text-left transition-colors hover:text-ink ${active ? "text-accent" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <SortMark active={active} dir={dir} />
    </button>
  );
}

function SortHead({
  label, hint, sortKey, sort, onSort, className,
}: {
  label: string;
  hint?: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`px-3 py-2.5 text-left font-medium ${className ?? ""}`}>
      <button type="button" className={`group/sort inline-flex items-start gap-1 text-left transition-colors hover:text-ink ${active ? "text-accent" : ""}`} onClick={() => onSort(sortKey)}>
        <span>
          {label}
          {hint && <span className="block text-[10.5px] font-normal text-ink-4">{hint}</span>}
        </span>
        <SortMark active={active} dir={sort.dir} />
      </button>
    </th>
  );
}
