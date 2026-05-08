import { PortExecution } from "../src/core/execution/PortExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

describe("PortExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, null, "player_id"),
        new PlayerInfo("other", PlayerType.Human, null, "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    player.addGold(BigInt(1000000));
    other = game.player("other_id");
    other.addGold(BigInt(1000000));

    game.config().structureMinDist = () => 0;
  });

  function buildCoastPort(p: Player, y: number) {
    p.conquer(game.ref(7, y));
    const spawn = p.canBuild(UnitType.Port, game.ref(7, y));
    if (spawn === false) throw new Error(`Unable to build port at (7,${y})`);
    const port = p.buildUnit(UnitType.Port, spawn, {});
    game.addExecution(new PortExecution(port));
    return port;
  }

  test("trade ship spawns to a valid port", () => {
    buildCoastPort(player, 10);
    buildCoastPort(other, 2);

    let tradeShipSeen = false;
    for (let i = 0; i < 5000; i++) {
      game.executeNextTick();
      if (game.unitCount(UnitType.TradeShip) > 0) {
        tradeShipSeen = true;
        break;
      }
    }
    expect(tradeShipSeen).toBe(true);
  });

  test("port cooldown prevents sending to same port repeatedly", () => {
    game.config().tradeShipPortCooldown = () => 10000;

    buildCoastPort(player, 10);
    // Build other port without PortExecution so only player's port sends
    other.conquer(game.ref(7, 2));
    const spawn = other.canBuild(UnitType.Port, game.ref(7, 2));
    if (spawn === false) throw new Error("Unable to build other port");
    other.buildUnit(UnitType.Port, spawn, {});

    let tradeShipCount = 0;
    for (let i = 0; i < 5000; i++) {
      game.executeNextTick();
      const current = game.unitCount(UnitType.TradeShip);
      if (current > tradeShipCount) tradeShipCount = current;
    }
    expect(tradeShipCount).toBeLessThanOrEqual(1);
  });
});
