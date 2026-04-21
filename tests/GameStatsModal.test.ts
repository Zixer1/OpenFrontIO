import { describe, test, expect, vi } from "vitest";
import { PlayerType } from "../src/core/game/Game";
import {
  GameHistory,
  GameStatsModal,
  OverviewRow,
} from "../src/client/graphics/layers/GameStatsModal";
import { AllPlayersStats } from "../src/core/Schemas";

vi.mock("../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (v: number) => String(v),
  formatPercentage: (v: number) => `${(v * 100).toFixed(1)}%`,
}));

function fakeColor(hex: string) {
  return { toHex: () => hex };
}

function fakePlayer(opts: {
  id: string;
  clientID: string | null;
  name: string;
  type: PlayerType;
  alive: boolean;
  gold: bigint;
  troops: number;
  tiles: number;
}) {
  return {
    id: () => opts.id,
    clientID: () => opts.clientID,
    displayName: () => opts.name,
    type: () => opts.type,
    isAlive: () => opts.alive,
    gold: () => opts.gold,
    troops: () => opts.troops,
    numTilesOwned: () => opts.tiles,
    territoryColor: () => fakeColor("#ff0000"),
  } as any;
}

function fakeGame(opts: {
  players: ReturnType<typeof fakePlayer>[];
  ticks: number;
  numLand: number;
  myClientID?: string;
}) {
  return {
    playerViews: () => opts.players,
    ticks: () => opts.ticks,
    numLandTiles: () => opts.numLand,
    myPlayer: () =>
      opts.myClientID
        ? opts.players.find((p: any) => p.clientID() === opts.myClientID)
        : undefined,
  } as any;
}

function buildRows(
  game: any,
  allPlayersStats: AllPlayersStats | null,
  history: GameHistory | null,
  winnerID: string | null = null,
): OverviewRow[] {
  const el = new GameStatsModal();
  el.game = game;
  el.allPlayersStats = allPlayersStats;
  el.history = history;
  el.winnerID = winnerID;
  return el.buildOverviewRows();
}

describe("GameStatsModal buildOverviewRows", () => {
  const emptyHistory: GameHistory = {
    labels: [],
    territory: {},
    gold: {},
    troops: {},
  };

  test("returns rows for all players including nations", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: true,
      gold: 100n,
      troops: 50,
      tiles: 10,
    });
    const p2 = fakePlayer({
      id: "p2",
      clientID: null,
      name: "Rome",
      type: PlayerType.Nation,
      alive: false,
      gold: 200n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({
      players: [p1, p2],
      ticks: 600,
      numLand: 100,
      myClientID: "c1",
    });
    const rows = buildRows(game, null, emptyHistory);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].isMe).toBe(true);
    expect(rows[1].name).toBe("Rome");
    expect(rows[1].playerType).toBe(PlayerType.Nation);
  });

  test("uses stats gold when available, falls back to player.gold()", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: true,
      gold: 999n,
      troops: 0,
      tiles: 0,
    });
    const p2 = fakePlayer({
      id: "p2",
      clientID: null,
      name: "Rome",
      type: PlayerType.Nation,
      alive: true,
      gold: 500n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1, p2], ticks: 100, numLand: 100 });
    const stats: AllPlayersStats = {
      c1: { gold: [100n, 200n, 50n, 0n, 0n, 0n] },
    };
    const rows = buildRows(game, stats, emptyHistory);
    expect(rows[0].goldTotal).toBe(350);
    expect(rows[1].goldTotal).toBe(500);
  });

  test("gold falls back to history max when no stats and player is dead", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: null,
      name: "Rome",
      type: PlayerType.Nation,
      alive: false,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1], ticks: 600, numLand: 100 });
    const history: GameHistory = {
      labels: ["0:00", "0:06", "0:12"],
      territory: {},
      gold: { p1: [100, 500, 300] },
      troops: {},
    };
    const rows = buildRows(game, null, history);
    expect(rows[0].goldTotal).toBe(500);
  });

  test("uses history peak for territory percentage", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: true,
      gold: 0n,
      troops: 0,
      tiles: 5,
    });
    const game = fakeGame({ players: [p1], ticks: 100, numLand: 100 });
    const history: GameHistory = {
      labels: ["0:00", "0:06"],
      territory: { p1: [10, 30] },
      gold: {},
      troops: {},
    };
    const rows = buildRows(game, null, history);
    expect(rows[0].peakTerritoryPct).toBe(0.3);
  });

  test("alive players show 'alive' text", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: true,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1], ticks: 600, numLand: 100 });
    const rows = buildRows(game, null, emptyHistory);
    expect(rows[0].survival).toBe("stats_modal.alive");
  });

  test("dead players with killedAt show computed time", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: false,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1], ticks: 6000, numLand: 100 });
    const stats: AllPlayersStats = { c1: { killedAt: 3000n } };
    const rows = buildRows(game, stats, emptyHistory);
    expect(rows[0].survival).toBe("5m 00s");
  });

  test("dead players without stats use game ticks for survival", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: null,
      name: "Rome",
      type: PlayerType.Nation,
      alive: false,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1], ticks: 1200, numLand: 100 });
    const rows = buildRows(game, null, emptyHistory);
    expect(rows[0].survival).toBe("2m 00s");
  });

  test("winner gets isWinner flag", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: "c1",
      name: "Alice",
      type: PlayerType.Human,
      alive: true,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const p2 = fakePlayer({
      id: "p2",
      clientID: "c2",
      name: "Bob",
      type: PlayerType.Human,
      alive: true,
      gold: 0n,
      troops: 0,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1, p2], ticks: 100, numLand: 100 });
    const rows = buildRows(game, null, emptyHistory, "p1");
    expect(rows[0].isWinner).toBe(true);
    expect(rows[1].isWinner).toBe(false);
  });

  test("troops fallback to history peak when no stats", () => {
    const p1 = fakePlayer({
      id: "p1",
      clientID: null,
      name: "Tribe",
      type: PlayerType.Bot,
      alive: true,
      gold: 0n,
      troops: 10,
      tiles: 0,
    });
    const game = fakeGame({ players: [p1], ticks: 100, numLand: 100 });
    const history: GameHistory = {
      labels: ["0:00", "0:06"],
      territory: {},
      gold: {},
      troops: { p1: [100, 200, 150] },
    };
    const rows = buildRows(game, null, history);
    expect(rows[0].troopsSent).toBe(200);
  });
});
