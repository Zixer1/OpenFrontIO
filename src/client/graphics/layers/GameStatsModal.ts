import { LitElement, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatPercentage, renderNumber, translateText } from "../../Utils";
import { AllPlayersStats } from "../../../core/Schemas";
import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  boatUnits,
  bombUnits,
  otherUnits,
  BOAT_INDEX_SENT,
  BOAT_INDEX_ARRIVE,
} from "../../../core/StatsSchemas";

export interface GameHistory {
  labels: string[];
  territory: Record<string, number[]>;
  gold: Record<string, number[]>;
  troops: Record<string, number[]>;
}

type TabId = "overview" | "territory" | "economy" | "military" | "nuclear";

const TABS: { id: TabId; key: string }[] = [
  { id: "overview", key: "stats_modal.tab_overview" },
  { id: "territory", key: "stats_modal.tab_territory" },
  { id: "economy", key: "stats_modal.tab_economy" },
  { id: "military", key: "stats_modal.tab_military" },
  { id: "nuclear", key: "stats_modal.tab_nuclear" },
];

const GOLD_COLORS = ["#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#06b6d4"];

function arrMax(arr: number[], fallback = 0): number {
  let m = fallback;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

const UNIT_COLORS: Record<string, string> = {
  city: "#60a5fa",
  defp: "#34d399",
  port: "#a78bfa",
  wshp: "#f87171",
  silo: "#fbbf24",
  saml: "#fb923c",
  fact: "#94a3b8",
};

type OverviewSortKey =
  | "peakTerritoryPct"
  | "goldTotal"
  | "troopsSent"
  | "structuresBuilt"
  | "nukesLaunched"
  | "betrayals";

interface ChartSeries {
  id: string;
  name: string;
  color: string;
  values: number[];
  sortVal: number;
}

function typeBadge(type: PlayerType) {
  if (type === PlayerType.Nation)
    return html`<span
      class="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300/80 ml-1"
      >${translateText("player_type.nation")}</span
    >`;
  if (type === PlayerType.Bot)
    return html`<span
      class="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300/80 ml-1"
      >${translateText("player_type.bot")}</span
    >`;
  return html``;
}

export interface OverviewRow {
  isMe: boolean;
  isWinner: boolean;
  color: string;
  name: string;
  playerType: PlayerType;
  peakTerritoryPct: number;
  territory: string;
  survival: string;
  goldTotal: number;
  troopsSent: number;
  structuresBuilt: number;
  nukesLaunched: number;
  betrayals: number;
}

const CHART_COUNTS = [10, 25, 50, 0] as const;

@customElement("game-stats-modal")
export class GameStatsModal extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) allPlayersStats: AllPlayersStats | null = null;
  @property({ type: Object }) history: GameHistory | null = null;
  @property({ type: String }) winnerID: string | null = null;

  @state() private activeTab: TabId = "overview";
  @state() private _sortKey: OverviewSortKey = "goldTotal";
  @state() private _sortDir: "asc" | "desc" = "desc";
  @state() private _displayCount: number = 10;
  @state() private _chartLimit: number = 10;

  // Per-chart range state: key is chart title hash
  private _rangeStarts: Record<string, number> = {};
  private _rangeEnds: Record<string, number> = {};
  // Tooltip state (not reactive - updated via DOM)
  private _tooltipEl: HTMLElement | null = null;

  close() {
    this.dispatchEvent(new CustomEvent("stats-close", { bubbles: true }));
  }

  private statsFor(p: PlayerView) {
    const cid = p.clientID();
    return cid !== null ? this.allPlayersStats?.[cid] ?? undefined : undefined;
  }

  render() {
    if (!this.game) return html``;
    return html`
      <div
        class="fixed inset-0 z-[10020] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="bg-gray-900 rounded-xl w-full max-w-5xl flex flex-col shadow-2xl border border-white/10"
          style="max-height: 88vh"
        >
          <div
            class="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0"
          >
            <h2 class="text-lg font-bold text-white m-0">
              ${translateText("stats_modal.title")}
            </h2>
            <button
              @click=${this.close}
              class="text-gray-400 hover:text-white text-xl leading-none px-2 py-0.5 cursor-pointer border-0 bg-transparent transition-colors"
            >
              ✕
            </button>
          </div>
          <div
            class="flex border-b border-white/10 px-5 shrink-0 overflow-x-auto"
          >
            ${TABS.map(
              (t) => html`
                <button
                  @click=${() => {
                    this.activeTab = t.id;
                  }}
                  class="${this.activeTab === t.id
                    ? "border-b-2 border-blue-400 text-blue-300 font-semibold"
                    : "border-b-2 border-transparent text-gray-400 hover:text-white"} px-4 py-2.5 text-sm whitespace-nowrap cursor-pointer bg-transparent border-x-0 border-t-0 transition-colors"
                >
                  ${translateText(t.key)}
                </button>
              `,
            )}
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            ${this.renderActiveTab()}
          </div>
        </div>
      </div>
    `;
  }

  private renderActiveTab() {
    switch (this.activeTab) {
      case "overview":
        return this.renderOverview();
      case "territory":
        return this.renderTerritory();
      case "economy":
        return this.renderEconomy();
      case "military":
        return this.renderMilitary();
      case "nuclear":
        return this.renderNuclear();
    }
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  buildOverviewRows(): OverviewRow[] {
    if (!this.game) return [];
    const numLand = this.game.numLandTiles() || 1;
    const myClientID = this.game.myPlayer()?.clientID() ?? null;
    const gameTicks = this.game.ticks();

    return this.game.playerViews().map((p) => {
      const pid = p.id();
      const cid = p.clientID();
      const stats = this.statsFor(p);

      const statsGold = (stats?.gold ?? []).reduce(
        (s, v) => s + Number(v),
        0,
      );
      const histGold = this.history?.gold[pid] ?? [];
      const goldTotal =
        statsGold > 0
          ? statsGold
          : histGold.length > 0
            ? arrMax(histGold)
            : Number(p.gold());

      const statsTroops = Number(stats?.attacks?.[0] ?? 0n);
      const histTroops = this.history?.troops[pid] ?? [];
      const troopsSent =
        statsTroops > 0
          ? statsTroops
          : histTroops.length > 0
            ? arrMax(histTroops)
            : p.troops();

      const structuresBuilt = Number(
        Object.values(stats?.units ?? {}).reduce(
          (s, arr) => s + (arr?.[0] ?? 0n),
          0n,
        ),
      );

      const nukesLaunched = Number(
        Object.values(stats?.bombs ?? {}).reduce(
          (s, arr) => s + (arr?.[0] ?? 0n),
          0n,
        ),
      );

      const betrayals = Number(stats?.betrayals ?? 0n);

      const terrHist = this.history?.territory[pid] ?? [];
      const peakTiles =
        terrHist.length > 0
          ? arrMax(terrHist, p.numTilesOwned())
          : p.numTilesOwned();
      const peakTerritoryPct = peakTiles / numLand;

      const killedAt = stats?.killedAt;
      let survivalTicks: number;
      if (killedAt !== undefined && killedAt > 0n) {
        survivalTicks = Number(killedAt);
      } else {
        survivalTicks = gameTicks;
      }
      const totalSecs = Math.round((survivalTicks * 100) / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const survival = p.isAlive()
        ? translateText("stats_modal.alive")
        : `${mins}m ${secs.toString().padStart(2, "0")}s`;

      return {
        isMe: cid !== null && cid === myClientID,
        isWinner: this.winnerID !== null && pid === this.winnerID,
        color: p.territoryColor().toHex(),
        name: p.displayName(),
        playerType: p.type(),
        peakTerritoryPct,
        territory: formatPercentage(peakTerritoryPct),
        survival,
        goldTotal,
        troopsSent,
        structuresBuilt,
        nukesLaunched,
        betrayals,
      };
    });
  }

  private _toggleSort(key: OverviewSortKey) {
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortDir = "desc";
    }
  }

  private renderOverview() {
    if (!this.game) return this.noData();

    const rows = this.buildOverviewRows();
    const dir = this._sortDir === "desc" ? -1 : 1;
    const key = this._sortKey;
    rows.sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return av < bv ? dir : av > bv ? -dir : 0;
    });

    const total = rows.length;
    // Always keep the viewer in the visible set
    const meIdx = rows.findIndex((r) => r.isMe);
    let visible: OverviewRow[];
    if (this._displayCount >= total) {
      visible = rows;
    } else {
      const sliced = rows.slice(0, this._displayCount);
      if (meIdx >= this._displayCount && meIdx !== -1) {
        sliced[sliced.length - 1] = rows[meIdx];
      }
      visible = sliced;
    }

    const arrow = (k: OverviewSortKey) =>
      this._sortKey !== k ? "" : this._sortDir === "desc" ? " ▼" : " ▲";
    const thCls =
      "px-2 py-2 text-right cursor-pointer select-none hover:text-white transition-colors";

    return html`
      <div class="flex items-center justify-between mb-2">
        <div class="text-gray-400 text-xs font-semibold uppercase tracking-wider">
          ${translateText("stats_modal.tab_overview")}
        </div>
        ${this._renderCountButtons(
          this._displayCount,
          (c) => {
            this._displayCount = c;
          },
          total,
        )}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr
              class="text-gray-400 text-xs uppercase font-medium border-b border-white/10"
            >
              <th class="px-3 py-2 text-left">
                ${translateText("stats_modal.col_player")}
              </th>
              <th
                class="${thCls} text-green-400"
                @click=${() => this._toggleSort("peakTerritoryPct")}
              >
                ${translateText("stats_modal.col_territory")}${arrow(
                  "peakTerritoryPct",
                )}
              </th>
              <th
                class="${thCls} text-yellow-400"
                @click=${() => this._toggleSort("goldTotal")}
              >
                ${translateText("stats_modal.col_gold")}${arrow("goldTotal")}
              </th>
              <th
                class="${thCls} text-blue-400"
                @click=${() => this._toggleSort("troopsSent")}
              >
                ${translateText("stats_modal.col_troops")}${arrow("troopsSent")}
              </th>
              <th
                class="${thCls} text-emerald-400"
                @click=${() => this._toggleSort("structuresBuilt")}
              >
                ${translateText("stats_modal.col_built")}${arrow(
                  "structuresBuilt",
                )}
              </th>
              <th
                class="${thCls} text-red-400"
                @click=${() => this._toggleSort("nukesLaunched")}
              >
                ${translateText("stats_modal.col_nukes")}${arrow(
                  "nukesLaunched",
                )}
              </th>
              <th
                class="${thCls} text-orange-400"
                @click=${() => this._toggleSort("betrayals")}
              >
                ${translateText("stats_modal.col_betrayals")}${arrow(
                  "betrayals",
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(
              (r) => html`
                <tr
                  class="${r.isMe
                    ? "bg-blue-900/20"
                    : "hover:bg-white/3"} border-b border-white/5 transition-colors"
                >
                  <td class="px-3 py-2.5">
                    <div class="flex items-center gap-2">
                      <span
                        class="w-3 h-3 rounded-full shrink-0"
                        style="background:${r.color}"
                      ></span>
                      <span
                        class="${r.isMe
                          ? "text-white font-semibold"
                          : "text-white/80"}"
                        >${r.isWinner ? "👑 " : ""}${r.name}${typeBadge(
                          r.playerType,
                        )}</span
                      >
                    </div>
                  </td>
                  <td class="px-2 py-2.5 text-right text-green-300/80 tabular-nums">
                    ${r.territory}
                  </td>
                  <td class="px-2 py-2.5 text-right text-yellow-300/80 tabular-nums">
                    ${renderNumber(r.goldTotal)}
                  </td>
                  <td class="px-2 py-2.5 text-right text-blue-300/80 tabular-nums">
                    ${renderNumber(r.troopsSent)}
                  </td>
                  <td class="px-2 py-2.5 text-right text-emerald-300/80 tabular-nums">
                    ${renderNumber(r.structuresBuilt)}
                  </td>
                  <td class="px-2 py-2.5 text-right text-red-300/80 tabular-nums">
                    ${renderNumber(r.nukesLaunched)}
                  </td>
                  <td class="px-2 py-2.5 text-right text-orange-300/80 tabular-nums">
                    ${renderNumber(r.betrayals)}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── Territory ─────────────────────────────────────────────────────────────

  private renderTerritory() {
    if (!this.history || this.history.labels.length < 2)
      return this.collecting();

    const numLand = this.game!.numLandTiles() || 1;
    const series: ChartSeries[] = this.game!
      .playerViews()
      .filter((p) => (this.history!.territory[p.id()] ?? []).some((v) => v > 0))
      .map((p) => {
        const vals = (this.history!.territory[p.id()] ?? []).map(
          (v) => (v / numLand) * 100,
        );
        return {
          id: p.id(),
          name: p.displayName(),
          color: p.territoryColor().toHex(),
          values: vals,
          sortVal: arrMax(vals),
        };
      });

    return this.chartWithControls(
      series,
      this.history.labels,
      (v) => `${v.toFixed(0)}%`,
      translateText("stats_modal.territory_over_time"),
      "territory",
    );
  }

  // ── Economy ───────────────────────────────────────────────────────────────

  private renderEconomy() {
    if (!this.game) return this.noData();

    const goldLabels = [
      translateText("stats_modal.gold_workers"),
      translateText("stats_modal.gold_war"),
      translateText("stats_modal.gold_trade"),
      translateText("stats_modal.gold_piracy"),
      translateText("stats_modal.gold_trains"),
    ];

    const players = this.game
      .playerViews()
      .map((p) => {
        const stats = this.statsFor(p);
        const sources = [
          Number(stats?.gold?.[0] ?? 0n),
          Number(stats?.gold?.[1] ?? 0n),
          Number(stats?.gold?.[2] ?? 0n),
          Number(stats?.gold?.[3] ?? 0n),
          Number(stats?.gold?.[4] ?? 0n) + Number(stats?.gold?.[5] ?? 0n),
        ];
        const tradeSent = Number(stats?.boats?.trade?.[BOAT_INDEX_SENT] ?? 0n);
        const tradeArrived = Number(
          stats?.boats?.trade?.[BOAT_INDEX_ARRIVE] ?? 0n,
        );
        const factoriesBuilt = Number(stats?.units?.fact?.[0] ?? 0n);
        return {
          name: p.displayName(),
          color: p.territoryColor().toHex(),
          playerType: p.type(),
          isMe:
            p.clientID() !== null &&
            p.clientID() === this.game!.myPlayer()?.clientID(),
          sources,
          total: sources.reduce((s, v) => s + v, 0),
          tradeSent,
          tradeArrived,
          factoriesBuilt,
        };
      })
      .filter(
        (p) => p.total > 0 || p.tradeSent > 0 || p.factoriesBuilt > 0,
      )
      .sort((a, b) => b.total - a.total);

    const hasGoldHist =
      this.history !== null && this.history.labels.length >= 2;

    if (players.length === 0 && !hasGoldHist) return this.collecting();

    return html`
      <div class="space-y-5">
        ${players.length > 0
          ? html`
              <div class="flex flex-wrap gap-3">
                ${goldLabels.map(
                  (l, i) => html`
                    <div
                      class="flex items-center gap-1.5 text-xs text-white/60"
                    >
                      <span
                        class="w-3 h-2 rounded-sm inline-block"
                        style="background:${GOLD_COLORS[i]}"
                      ></span>
                      ${l}
                    </div>
                  `,
                )}
              </div>
              <div class="space-y-2.5">
                ${players
                  .filter((p) => p.total > 0)
                  .map(
                    (p) => html`
                      <div class="flex items-center gap-3">
                        <div class="w-28 shrink-0 text-right">
                          <span
                            class="${p.isMe
                              ? "text-white font-semibold"
                              : "text-white/70"} text-xs truncate"
                            >${p.name}${typeBadge(p.playerType)}</span
                          >
                        </div>
                        <div
                          class="flex-1 flex h-5 rounded-sm overflow-hidden bg-white/5"
                          style="gap:1px"
                        >
                          ${p.sources.map((v, i) =>
                            v > 0
                              ? html`<div
                                  style="flex:${v};background:${GOLD_COLORS[i]}"
                                  title="${goldLabels[i]}: ${renderNumber(v)}"
                                  class="min-w-px"
                                ></div>`
                              : html``,
                          )}
                        </div>
                        <div
                          class="w-14 text-right text-yellow-300/70 text-xs tabular-nums shrink-0"
                        >
                          ${renderNumber(p.total)}
                        </div>
                      </div>
                    `,
                  )}
              </div>
              ${players.some((p) => p.tradeSent > 0 || p.factoriesBuilt > 0)
                ? html`
                    <div class="pt-4 border-t border-white/10">
                      <div
                        class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3"
                      >
                        ${translateText("stats_modal.trade_and_factories")}
                      </div>
                      <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                          <thead>
                            <tr
                              class="text-gray-400 text-xs uppercase border-b border-white/10"
                            >
                              <th class="px-3 py-1.5 text-left">
                                ${translateText("stats_modal.col_player")}
                              </th>
                              <th class="px-2 py-1.5 text-right text-cyan-400">
                                ${translateText(
                                  "stats_modal.trade_ships_sent",
                                )}
                              </th>
                              <th
                                class="px-2 py-1.5 text-right text-green-400"
                              >
                                ${translateText(
                                  "stats_modal.trade_ships_arrived",
                                )}
                              </th>
                              <th
                                class="px-2 py-1.5 text-right text-gray-400"
                              >
                                ${translateText(
                                  "stats_modal.factories_built",
                                )}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            ${players
                              .filter(
                                (p) =>
                                  p.tradeSent > 0 || p.factoriesBuilt > 0,
                              )
                              .map(
                                (p) => html`
                                  <tr
                                    class="${p.isMe
                                      ? "bg-blue-900/20"
                                      : "hover:bg-white/3"} border-b border-white/5"
                                  >
                                    <td class="px-3 py-2">
                                      <div
                                        class="flex items-center gap-2"
                                      >
                                        <span
                                          class="w-2.5 h-2.5 rounded-full shrink-0"
                                          style="background:${p.color}"
                                        ></span>
                                        <span
                                          class="${p.isMe
                                            ? "text-white font-semibold"
                                            : "text-white/70"} text-xs"
                                          >${p.name}${typeBadge(
                                            p.playerType,
                                          )}</span
                                        >
                                      </div>
                                    </td>
                                    <td
                                      class="px-2 py-2 text-right text-cyan-300/70 text-xs tabular-nums"
                                    >
                                      ${p.tradeSent || "—"}
                                    </td>
                                    <td
                                      class="px-2 py-2 text-right text-green-300/70 text-xs tabular-nums"
                                    >
                                      ${p.tradeArrived || "—"}
                                    </td>
                                    <td
                                      class="px-2 py-2 text-right text-gray-300/70 text-xs tabular-nums"
                                    >
                                      ${p.factoriesBuilt || "—"}
                                    </td>
                                  </tr>
                                `,
                              )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  `
                : html``}
            `
          : html``}
        ${hasGoldHist
          ? html`
              <div
                class="${players.length > 0
                  ? "pt-5 border-t border-white/10"
                  : ""}"
              >
                ${this.chartWithControls(
                  this.game!
                    .playerViews()
                    .filter((p) =>
                      (this.history!.gold[p.id()] ?? []).some((v) => v > 0),
                    )
                    .map((p) => {
                      const vals = this.history!.gold[p.id()] ?? [];
                      return {
                        id: p.id(),
                        name: p.displayName(),
                        color: p.territoryColor().toHex(),
                        values: vals,
                        sortVal: arrMax(vals),
                      };
                    }),
                  this.history!.labels,
                  (v) => renderNumber(v),
                  translateText("stats_modal.gold_over_time"),
                  "gold",
                )}
              </div>
            `
          : html``}
      </div>
    `;
  }

  // ── Military ──────────────────────────────────────────────────────────────

  private renderMilitary() {
    if (!this.game) return this.noData();

    const unitNames: Record<string, string> = Object.fromEntries(
      otherUnits.map((k) => [
        k,
        translateText(`player_stats_table.unit.${k}`),
      ]),
    );

    const players = this.game
      .playerViews()
      .map((p) => {
        const stats = this.statsFor(p);
        const troopsSent = Number(stats?.attacks?.[0] ?? 0n);
        const unitBreakdown: Record<string, number> = {};
        for (const key of otherUnits)
          unitBreakdown[key] = Number(stats?.units?.[key]?.[0] ?? 0n);
        return {
          name: p.displayName(),
          color: p.territoryColor().toHex(),
          playerType: p.type(),
          isMe:
            p.clientID() !== null &&
            p.clientID() === this.game!.myPlayer()?.clientID(),
          troopsSent,
          unitBreakdown,
          totalUnits: Object.values(unitBreakdown).reduce((s, v) => s + v, 0),
        };
      });

    const withTroops = players
      .filter((p) => p.troopsSent > 0)
      .sort((a, b) => b.troopsSent - a.troopsSent);
    const withUnits = players
      .filter((p) => p.totalUnits > 0)
      .sort((a, b) => b.totalUnits - a.totalUnits);
    const maxTr = withTroops.length > 0 ? withTroops[0].troopsSent : 1;
    const hasTroopsHist =
      this.history !== null && this.history.labels.length >= 2;

    if (withTroops.length === 0 && withUnits.length === 0 && !hasTroopsHist)
      return this.collecting();

    return html`
      <div class="space-y-6">
        ${withTroops.length > 0
          ? html`
              <div>
                <div
                  class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3"
                >
                  ${translateText("stats_modal.troops_sent")}
                </div>
                <div class="space-y-2">
                  ${withTroops.map(
                    (p) => html`
                      <div class="flex items-center gap-3">
                        <div class="w-28 shrink-0 text-right">
                          <span
                            class="${p.isMe
                              ? "text-white font-semibold"
                              : "text-white/70"} text-xs"
                            >${p.name}${typeBadge(p.playerType)}</span
                          >
                        </div>
                        <div
                          class="flex-1 bg-white/5 rounded-sm h-4 overflow-hidden"
                        >
                          <div
                            class="h-full rounded-sm"
                            style="width:${((p.troopsSent / maxTr) * 100).toFixed(1)}%;background:${p.color}90"
                          ></div>
                        </div>
                        <div
                          class="w-14 text-right text-blue-300/70 text-xs tabular-nums shrink-0"
                        >
                          ${renderNumber(p.troopsSent)}
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
          : html``}
        ${withUnits.length > 0
          ? html`
              <div>
                <div
                  class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2"
                >
                  ${translateText("stats_modal.structures_built")}
                </div>
                <div class="flex flex-wrap gap-3 mb-3">
                  ${otherUnits.map(
                    (key) => html`
                      <div
                        class="flex items-center gap-1.5 text-xs text-white/60"
                      >
                        <span
                          class="w-3 h-2 rounded-sm inline-block"
                          style="background:${UNIT_COLORS[key]}"
                        ></span>
                        ${unitNames[key]}
                      </div>
                    `,
                  )}
                </div>
                <div class="space-y-2">
                  ${withUnits.map(
                    (p) => html`
                      <div class="flex items-center gap-3">
                        <div class="w-28 shrink-0 text-right">
                          <span
                            class="${p.isMe
                              ? "text-white font-semibold"
                              : "text-white/70"} text-xs"
                            >${p.name}${typeBadge(p.playerType)}</span
                          >
                        </div>
                        <div
                          class="flex-1 flex h-4 rounded-sm overflow-hidden bg-white/5"
                          style="gap:1px"
                        >
                          ${otherUnits.map((key) =>
                            p.unitBreakdown[key] > 0
                              ? html`<div
                                  style="flex:${p.unitBreakdown[key]};background:${UNIT_COLORS[key]}"
                                  title="${unitNames[key]}: ${p.unitBreakdown[key]}"
                                  class="min-w-px"
                                ></div>`
                              : html``,
                          )}
                        </div>
                        <div
                          class="w-14 text-right text-emerald-300/70 text-xs tabular-nums shrink-0"
                        >
                          ${renderNumber(p.totalUnits)}
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
          : html``}
        ${hasTroopsHist
          ? html`
              <div
                class="${withTroops.length > 0 || withUnits.length > 0
                  ? "pt-5 border-t border-white/10"
                  : ""}"
              >
                ${this.chartWithControls(
                  this.game!
                    .playerViews()
                    .filter((p) =>
                      (this.history!.troops[p.id()] ?? []).some((v) => v > 0),
                    )
                    .map((p) => {
                      const vals = this.history!.troops[p.id()] ?? [];
                      return {
                        id: p.id(),
                        name: p.displayName(),
                        color: p.territoryColor().toHex(),
                        values: vals,
                        sortVal: arrMax(vals),
                      };
                    }),
                  this.history!.labels,
                  (v) => renderNumber(v),
                  translateText("stats_modal.troops_over_time"),
                  "troops",
                )}
              </div>
            `
          : html``}
      </div>
    `;
  }

  // ── Nuclear ───────────────────────────────────────────────────────────────

  private renderNuclear() {
    if (!this.game) return this.noData();

    const nukeColors: Record<string, string> = {
      abomb: "#fbbf24",
      hbomb: "#f97316",
      mirv: "#ef4444",
      mirvw: "#dc2626",
    };

    const players = this.game
      .playerViews()
      .map((p) => {
        const stats = this.statsFor(p);
        const nukeData = bombUnits.map((nuke) => ({
          type: nuke,
          launched: Number(stats?.bombs?.[nuke]?.[0] ?? 0n),
          landed: Number(stats?.bombs?.[nuke]?.[1] ?? 0n),
          intercepted: Number(stats?.bombs?.[nuke]?.[2] ?? 0n),
        }));
        return {
          name: p.displayName(),
          color: p.territoryColor().toHex(),
          playerType: p.type(),
          isMe:
            p.clientID() !== null &&
            p.clientID() === this.game!.myPlayer()?.clientID(),
          nukeData,
          totalLaunched: nukeData.reduce((s, n) => s + n.launched, 0),
        };
      })
      .filter((p) => p.totalLaunched > 0)
      .sort((a, b) => b.totalLaunched - a.totalLaunched);

    if (players.length === 0)
      return html`<div
        class="text-gray-500 text-sm text-center py-16 flex flex-col items-center gap-2"
      >
        <span class="text-4xl">🕊️</span>
        <span>${translateText("stats_modal.no_nukes")}</span>
      </div>`;

    return html`
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-3 py-2 text-left text-gray-400 text-xs uppercase">
                ${translateText("stats_modal.col_player")}
              </th>
              ${bombUnits.map(
                (nuke) => html`
                  <th
                    class="px-2 py-2 text-center text-xs uppercase font-semibold"
                    colspan="3"
                    style="color:${nukeColors[nuke]}"
                  >
                    ${translateText(`player_stats_table.unit.${nuke}`)}
                  </th>
                `,
              )}
            </tr>
            <tr class="border-b border-white/5 text-[10px] text-gray-500">
              <th class="px-3 py-1"></th>
              ${bombUnits.map(
                () => html`
                  <th class="px-1 py-1 text-center" title="Launched">⬆</th>
                  <th class="px-1 py-1 text-center" title="Landed">💥</th>
                  <th class="px-1 py-1 text-center" title="Intercepted">🛡</th>
                `,
              )}
            </tr>
          </thead>
          <tbody>
            ${players.map(
              (p) => html`
                <tr
                  class="${p.isMe
                    ? "bg-blue-900/20"
                    : "hover:bg-white/3"} border-b border-white/5 transition-colors"
                >
                  <td class="px-3 py-2.5">
                    <div class="flex items-center gap-2">
                      <span
                        class="w-3 h-3 rounded-full shrink-0"
                        style="background:${p.color}"
                      ></span>
                      <span
                        class="${p.isMe
                          ? "text-white font-semibold"
                          : "text-white/70"} text-xs"
                        >${p.name}${typeBadge(p.playerType)}</span
                      >
                    </div>
                  </td>
                  ${p.nukeData.map(
                    (n) => html`
                      <td
                        class="px-1 py-2.5 text-center text-[11px] text-yellow-300/70 tabular-nums"
                      >
                        ${n.launched || "—"}
                      </td>
                      <td
                        class="px-1 py-2.5 text-center text-[11px] text-green-300/70 tabular-nums"
                      >
                        ${n.landed || "—"}
                      </td>
                      <td
                        class="px-1 py-2.5 text-center text-[11px] text-red-300/70 tabular-nums"
                      >
                        ${n.intercepted || "—"}
                      </td>
                    `,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── Chart with controls (limit + range slider) ────────────────────────────

  private chartWithControls(
    series: ChartSeries[],
    labels: string[],
    fmtVal: (v: number) => string,
    title: string,
    chartKey: string,
  ) {
    const myPid = this.game?.myPlayer()?.id();
    // Sort by sortVal descending; viewer goes first regardless
    series.sort((a, b) => {
      if (a.id === myPid) return -1;
      if (b.id === myPid) return 1;
      return b.sortVal - a.sortVal;
    });

    let limited: ChartSeries[];
    if (this._chartLimit >= series.length) {
      limited = series;
    } else {
      limited = series.slice(0, this._chartLimit);
      // Ensure viewer is included even if outside top N
      if (myPid && !limited.find((s) => s.id === myPid)) {
        const me = series.find((s) => s.id === myPid);
        if (me) limited[limited.length - 1] = me;
      }
    }

    // Override viewer color to bright red
    if (myPid) {
      limited = limited.map((s) =>
        s.id === myPid ? { ...s, color: "#ef4444" } : s,
      );
    }

    return html`
      <div>
        <div class="flex items-center justify-between mb-2">
          <div
            class="text-gray-400 text-xs font-semibold uppercase tracking-wider"
          >
            ${title}
          </div>
          ${this._renderCountButtons(
            this._chartLimit,
            (c) => {
              this._chartLimit = c;
            },
            series.length,
          )}
        </div>
        ${this.lineChart(limited, labels, fmtVal, chartKey)}
      </div>
    `;
  }

  // ── SVG line chart with tooltip + range slider ────────────────────────────

  lineChart(
    series: ChartSeries[],
    labels: string[],
    fmtVal: (v: number) => string,
    chartKey: string,
  ) {
    const active = series.filter((s) => s.values.length > 1);
    if (active.length === 0) return this.collecting();

    const totalLen = active[0].values.length;
    const rangeStart = this._rangeStarts[chartKey] ?? 0;
    const rangeEnd = this._rangeEnds[chartKey] ?? totalLen - 1;
    const lo = Math.max(0, Math.min(rangeStart, totalLen - 2));
    const hi = Math.min(totalLen - 1, Math.max(lo + 1, rangeEnd));

    const sliced = active.map((s) => ({
      ...s,
      values: s.values.slice(lo, hi + 1),
    }));
    const slicedLabels = labels.slice(lo, hi + 1);

    let maxV = 1;
    for (const s of sliced) maxV = arrMax(s.values, maxV);
    const W = 540,
      H = 200,
      pL = 46,
      pR = 12,
      pT = 12,
      pB = 32;
    const cW = W - pL - pR,
      cH = H - pT - pB;
    const n = sliced[0].values.length;
    const px = (i: number) => pL + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
    const py = (v: number) => pT + cH - (v / maxV) * cH;

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      yp: py(maxV * t),
      label: fmtVal(maxV * t),
    }));
    const xStep = Math.max(1, Math.floor(n / 6));
    const xIdx = Array.from({ length: n }, (_, i) => i).filter(
      (i) => i === 0 || i === n - 1 || i % xStep === 0,
    );

    const chartId = `chart-${chartKey}`;
    const tooltipId = `tooltip-${chartKey}`;

    const onMouseMove = (e: MouseEvent) => {
      const svgEl = (e.currentTarget as SVGSVGElement);
      const rect = svgEl.getBoundingClientRect();
      const scaleX = W / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * (H / rect.height);

      if (mouseX < pL || mouseX > W - pR || mouseY < pT || mouseY > pT + cH) {
        this._hideTooltip(tooltipId);
        return;
      }

      const idx = n > 1 ? Math.round(((mouseX - pL) / cW) * (n - 1)) : 0;
      const clampedIdx = Math.max(0, Math.min(n - 1, idx));

      let closest: { name: string; color: string; val: number; dy: number } | null = null;
      let minDy = Infinity;
      for (const s of sliced) {
        const val = s.values[clampedIdx];
        const sy = py(val);
        const dy = Math.abs(mouseY - sy);
        if (dy < minDy) {
          minDy = dy;
          closest = { name: s.name, color: s.color, val, dy };
        }
      }

      if (!closest || minDy > 30) {
        this._hideTooltip(tooltipId);
        return;
      }

      const tooltip = this.querySelector(`#${tooltipId}`) as HTMLElement | null;
      if (!tooltip) return;

      const xPx = px(clampedIdx) / W * rect.width;
      const yPx = py(closest.val) / H * rect.height;

      tooltip.style.display = "block";
      tooltip.style.left = `${xPx}px`;
      tooltip.style.top = `${yPx - 8}px`;
      tooltip.innerHTML = `
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="w-2 h-2 rounded-full inline-block" style="background:${closest.color}"></span>
          <span class="font-medium text-white">${closest.name}</span>
        </div>
        <div class="text-white/70">${fmtVal(closest.val)}</div>
        <div class="text-white/50 text-[9px]">${slicedLabels[clampedIdx] ?? ""}</div>
      `;
    };

    const onMouseLeave = () => this._hideTooltip(tooltipId);

    return html`
      <div class="relative" id="${chartId}">
        <svg
          viewBox="0 0 ${W} ${H}"
          class="w-full"
          style="overflow:visible"
          aria-hidden="true"
          @mousemove=${onMouseMove}
          @mouseleave=${onMouseLeave}
        >
          ${yTicks.map(
            (t) => svg`
            <line x1="${pL}" y1="${t.yp}" x2="${W - pR}" y2="${t.yp}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
            <text x="${pL - 5}" y="${t.yp + 3.5}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="end" font-family="ui-monospace,monospace">${t.label}</text>
          `,
          )}
          ${xIdx.map(
            (i) => svg`
            <text x="${px(i)}" y="${pT + cH + 18}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="middle" font-family="ui-monospace,monospace">${slicedLabels[i] ?? ""}</text>
            <line x1="${px(i)}" y1="${pT}" x2="${px(i)}" y2="${pT + cH}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
          `,
          )}
          ${sliced.map((s) => {
            const d = s.values
              .map(
                (v, i) =>
                  `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`,
              )
              .join(" ");
            return svg`<path d="${d}" stroke="${s.color}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
          })}
        </svg>
        <div
          id="${tooltipId}"
          class="absolute pointer-events-none bg-gray-800/95 border border-white/10 rounded px-2.5 py-1.5 text-[11px] leading-tight z-10 -translate-x-1/2 -translate-y-full"
          style="display:none"
        ></div>
        ${totalLen > 2
          ? html`
              <div class="flex items-center gap-3 mt-3">
                <span class="text-gray-500 text-[10px] shrink-0 w-10 text-right tabular-nums"
                  >${labels[lo] ?? ""}</span
                >
                <input
                  type="range"
                  min="0"
                  max="${totalLen - 2}"
                  .value=${String(lo)}
                  @input=${(e: Event) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    this._rangeStarts[chartKey] = v;
                    if (v >= (this._rangeEnds[chartKey] ?? totalLen - 1))
                      this._rangeEnds[chartKey] = Math.min(v + 1, totalLen - 1);
                    this.requestUpdate();
                  }}
                  class="flex-1 accent-blue-400 h-1 cursor-pointer"
                  style="appearance:auto"
                />
                <input
                  type="range"
                  min="1"
                  max="${totalLen - 1}"
                  .value=${String(hi)}
                  @input=${(e: Event) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    this._rangeEnds[chartKey] = v;
                    if (v <= (this._rangeStarts[chartKey] ?? 0))
                      this._rangeStarts[chartKey] = Math.max(v - 1, 0);
                    this.requestUpdate();
                  }}
                  class="flex-1 accent-blue-400 h-1 cursor-pointer"
                  style="appearance:auto"
                />
                <span class="text-gray-500 text-[10px] shrink-0 w-10 tabular-nums"
                  >${labels[hi] ?? ""}</span
                >
              </div>
            `
          : html``}
        <div class="flex flex-wrap gap-4 mt-3">
          ${active.map(
            (s) => html`
              <div class="flex items-center gap-1.5 text-xs"
                style="color:${s.color === "#ef4444" ? "#ef4444" : "rgba(255,255,255,0.6)"}"
              >
                <span
                  class="inline-block h-0.5 w-5 rounded"
                  style="background:${s.color}"
                ></span>
                ${s.name}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _hideTooltip(tooltipId: string) {
    const el = this.querySelector(`#${tooltipId}`) as HTMLElement | null;
    if (el) el.style.display = "none";
  }

  // ── Shared UI components ──────────────────────────────────────────────────

  private _renderCountButtons(
    current: number,
    setter: (v: number) => void,
    total: number,
  ) {
    return html`
      <div class="flex items-center gap-1.5 text-xs">
        <span class="text-gray-500">${translateText("stats_modal.show")}:</span>
        ${CHART_COUNTS.map((c) => {
          const label =
            c === 0 ? translateText("stats_modal.show_all") : String(c);
          const isActive =
            c === 0 ? current >= total : current === c;
          return html`<button
            @click=${() => setter(c === 0 ? Infinity : c)}
            class="${isActive
              ? "bg-white/15 text-white"
              : "bg-white/5 text-gray-400 hover:text-white"} px-2 py-0.5 rounded cursor-pointer border-0 transition-colors text-xs"
          >
            ${label}
          </button>`;
        })}
      </div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private noData() {
    return html`<div class="text-gray-500 text-sm text-center py-16">
      ${translateText("stats_modal.no_data")}
    </div>`;
  }

  private collecting() {
    return html`<div
      class="text-gray-500 text-sm text-center py-12 flex flex-col items-center gap-2"
    >
      <span class="text-3xl">📊</span>
      <span>${translateText("stats_modal.collecting")}</span>
    </div>`;
  }
}
