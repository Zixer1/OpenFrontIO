import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  getGamesPlayed,
  isInIframe,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { RankedType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { AllPlayersStats } from "../../../core/Schemas";
import { getUserMe } from "../../Api";
import "../../components/CosmeticButton";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { Platform } from "../../Platform";
import { SendWinnerEvent } from "../../Transport";
import { GameHistory } from "./GameStatsModal";
import "./GameStatsModal";
import { Layer } from "./Layer";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  // Time-series sampling (every SAMPLE_INTERVAL ticks ≈ every 6 s at 100 ms/tick)
  private static readonly SAMPLE_INTERVAL = 60;
  private _tickCount = 0;
  private _samplingDone = false;
  private _history: GameHistory = {
    labels: [],
    territory: {},
    gold: {},
    troops: {},
  };

  @state()
  isVisible = false;

  @state()
  private allPlayersStats: AllPlayersStats | null = null;

  @state()
  private _winnerID: string | null = null;

  @state()
  private statsOpen = false;

  @state()
  showButtons = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  @state()
  private patternContent: TemplateResult | null = null;

  private _title: string;

  private rand = Math.random();

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%] md:w-175"
          : "hidden"}"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white">
          ${this._title || ""}
        </h2>
        ${this.innerHtml()}
        <div
          class="${this.showButtons &&
          (this.allPlayersStats || this._history.labels.length >= 2)
            ? "mb-2.5"
            : "hidden"}"
        >
          <button
            @click=${this._openStats}
            class="w-full px-3 py-2.5 text-sm cursor-pointer bg-teal-600/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-teal-600/80 hover:-translate-y-px active:translate-y-px"
          >
            📊 ${translateText("win_modal.stats_btn")}
          </button>
        </div>
        <div
          class="${this.showButtons
            ? "flex justify-between gap-2.5"
            : "hidden"}"
        >
          <button
            @click=${this._handleExit}
            class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
          >
            ${translateText("win_modal.exit")}
          </button>
          ${this.isRankedGame
            ? html`
                <button
                  @click=${this._handleRequeue}
                  class="flex-1 px-3 py-3 text-base cursor-pointer bg-purple-600 text-white border-0 rounded-sm transition-all duration-200 hover:bg-purple-500 hover:-translate-y-px active:translate-y-px"
                >
                  ${translateText("win_modal.requeue")}
                </button>
              `
            : null}
          <button
            @click=${this.hide}
            class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
          >
            ${this.game?.myPlayer()?.isAlive()
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate")}
          </button>
        </div>
      </div>
      ${this.statsOpen
        ? html`
            <game-stats-modal
              .game=${this.game}
              .allPlayersStats=${this.allPlayersStats}
              .history=${this._history}
              .winnerID=${this._winnerID}
              @stats-close=${this._closeStats}
            ></game-stats-modal>
          `
        : html``}
    `;
  }

  innerHtml() {
    if (isInIframe()) {
      return this.steamWishlist();
    }

    if (!this.isWin && getGamesPlayed() < 3) {
      return this.renderYoutubeTutorial();
    }
    if (this.rand < 0.25) {
      return this.steamWishlist();
    } else if (this.rand < 0.5) {
      return this.discordDisplay();
    } else {
      return this.renderPatternButton();
    }
  }

  renderYoutubeTutorial() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.youtube_tutorial")}
        </h3>
        <!-- 56.25% = 9:16 -->
        <div class="relative w-full pb-[56.25%]">
          <iframe
            class="absolute top-0 left-0 w-full h-full rounded-sm"
            src="${this.isVisible ? TUTORIAL_VIDEO_URL : ""}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
  }

  renderPatternButton() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.support_openfront")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.territory_pattern")}
        </p>
        <div class="flex justify-center">${this.patternContent}</div>
      </div>
    `;
  }

  async loadPatternContent() {
    const me = await getUserMe();
    const cosmetics = await fetchCosmetics();

    const purchasable = resolveCosmetics(cosmetics, me, null).filter(
      (r) => r.type === "pattern" && r.relationship === "purchasable",
    );

    if (purchasable.length === 0) {
      this.patternContent = html``;
      return;
    }

    // Shuffle the array and take patterns based on screen size
    const shuffled = [...purchasable].sort(() => Math.random() - 0.5);
    const maxPatterns = Platform.isMobileWidth ? 1 : 3;
    const selected = shuffled.slice(0, Math.min(maxPatterns, shuffled.length));

    this.patternContent = html`
      <div class="flex gap-4 flex-wrap justify-start">
        ${selected.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  steamWishlist(): TemplateResult {
    return html`<p class="m-0 mb-5 text-center bg-black/30 p-2.5 rounded-sm">
      <a
        href="https://store.steampowered.com/app/3560670"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[#4a9eff] underline font-medium transition-colors duration-200 text-2xl hover:text-[#6db3ff]"
      >
        ${translateText("win_modal.wishlist")}
      </a>
    </p>`;
  }

  discordDisplay(): TemplateResult {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.join_discord")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.discord_description")}
        </p>
        <a
          href="https://discord.com/invite/openfront"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block px-6 py-3 bg-indigo-600 text-white rounded-sm font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline"
        >
          ${translateText("win_modal.join_server")}
        </a>
      </div>
    `;
  }

  async show() {
    crazyGamesSDK.gameplayStop();
    await this.loadPatternContent();
    // Check if this is a ranked game
    this.isRankedGame =
      this.game.config().gameConfig().rankedType === RankedType.OneVOne;
    this.isVisible = true;
    this.requestUpdate();
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  hide() {
    this.isVisible = false;
    this.showButtons = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  private _handleRequeue() {
    this.hide();
    // Navigate to homepage and open matchmaking modal
    window.location.href = "/?requeue";
  }

  init() {}

  private _sampleHistory() {
    if (this._samplingDone || this.game.inSpawnPhase()) return;
    const totalSeconds = Math.round((this._tickCount * 100) / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    this._history.labels.push(`${mins}:${secs.toString().padStart(2, "0")}`);
    for (const player of this.game.playerViews()) {
      const pid = player.id();
      if (!this._history.territory[pid]) this._history.territory[pid] = [];
      if (!this._history.gold[pid]) this._history.gold[pid] = [];
      if (!this._history.troops[pid]) this._history.troops[pid] = [];
      this._history.territory[pid].push(player.numTilesOwned());
      this._history.gold[pid].push(Number(player.gold()));
      this._history.troops[pid].push(player.troops());
    }
  }

  tick() {
    this._tickCount++;
    if (this._tickCount % WinModal.SAMPLE_INTERVAL === 0) {
      this._sampleHistory();
    }

    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
        }
        this._samplingDone = true;
        this.allPlayersStats = wu.allPlayersStats;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this._samplingDone = true;
        this.allPlayersStats = wu.allPlayersStats;
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        this._winnerID = winner.id();
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.displayName(),
          });
          this.isWin = false;
        }
        this._samplingDone = true;
        this.allPlayersStats = wu.allPlayersStats;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  private _openStats() {
    this.statsOpen = true;
  }

  private _closeStats() {
    this.statsOpen = false;
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }
}
