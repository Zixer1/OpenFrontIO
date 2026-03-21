import { HealAtPortExecution } from "../src/core/execution/HealAtPortExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Warship", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Warship heals only if player has port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 0;

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();

    expect(warship.health()).toBe(maxHealth);
    warship.modifyHealth(-10);
    expect(warship.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);
  });

  test("Warship gets bonus healing when near friendly port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 3;
    game.config().warshipPortHealingRadius = () => 30;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-10);
    game.executeNextTick();

    // +1 base healing and +3 near-port bonus healing
    expect(warship.health()).toBe(maxHealth - 6);
  });

  test("Low-health warship retreats to nearest friendly port and stays until fully healed", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const nearestPort = player1.buildUnit(
      UnitType.Port,
      game.ref(coastX, 10),
      {},
    );
    player1.buildUnit(UnitType.Port, game.ref(coastX, 12), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-700);

    executeTicks(game, 40);

    expect(warship.tile()).toBe(nearestPort.tile());

    const healthAtPort = warship.health();
    executeTicks(game, 20);

    expect(warship.tile()).toBe(nearestPort.tile());
    expect(warship.health()).toBeGreaterThan(healthAtPort);
    expect(warship.health()).toBeLessThan(maxHealth);
    expect(warship.retreating()).toBe(true);
  });

  test("Warship retreats when pre-heal health is below threshold", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }
    if (maxHealth <= 599) {
      expect(maxHealth).toBeGreaterThan(599);
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-(maxHealth - 599));

    game.executeNextTick();

    expect(warship.retreating()).toBe(true);
    expect(
      warship.tile() === homePort.tile() ||
        warship.targetTile() === homePort.tile(),
    ).toBe(true);
  });

  test("Low-health warship does not retreat when enemy warship is nearby", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;
    game.config().warshipTargettingRange = () => 5;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 5), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 15),
      {
        patrolTile: game.ref(coastX + 1, 15),
      },
    );
    const enemyWarship = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 15),
      {
        patrolTile: game.ref(coastX + 2, 15),
      },
    );

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new WarshipExecution(enemyWarship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    game.executeNextTick();

    expect(warship.targetUnit()).toBe(enemyWarship);
    expect(warship.targetTile()).not.toBe(homePort.tile());
    expect(warship.retreating()).toBe(false);
  });

  test("Manual MoveWarshipExecution cancels retreat and keeps manual order", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 20);

    expect(warship.retreating()).toBe(true);

    const manualPatrolTile = game.ref(coastX + 5, 15);
    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), manualPatrolTile),
    );

    executeTicks(game, 2);

    expect(warship.retreating()).toBe(false);
    expect(warship.patrolTile()).toBe(manualPatrolTile);
    expect(warship.targetTile()).toBe(manualPatrolTile);
  });

  test("Warship captures trade if player has port", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.owner()).toBe(player1);
  });

  test("Warship do not capture trade if player has no port", async () => {
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(UnitType.Port, game.ref(coastX, 11), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for warship to potentially capture trade ship
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship does not target trade ships that are safe from pirates", async () => {
    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    tradeShip.setSafeFromPirates();

    executeTicks(game, 10);

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship moves to new patrol tile", async () => {
    game.config().warshipTargettingRange = () => 1;

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship));

    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), game.ref(coastX + 5, 15)),
    );

    executeTicks(game, 10);

    expect(warship.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Warship does not not target trade ships outside of patrol range", async () => {
    game.config().warshipTargettingRange = () => 3;

    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("MoveWarshipExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveWarshipExecution(
      player2,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails if warship is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    warship.delete();
    new MoveWarshipExecution(
      player1,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails gracefully if warship not found", async () => {
    const exec = new MoveWarshipExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });

  test("Port level 1 allows only 1 warship to heal simultaneously", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 1;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    expect(port.level()).toBe(1); // Port starts at level 1

    const warship1 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    const warship2 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 10),
      {
        patrolTile: game.ref(coastX + 2, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship1));
    game.addExecution(new WarshipExecution(warship2));

    game.executeNextTick();
    warship1.modifyHealth(-700);
    warship2.modifyHealth(-700);
    executeTicks(game, 30);

    // Both warships are retreating to the port
    expect(warship1.retreating()).toBe(true);
    expect(warship2.retreating()).toBe(true);

    const health1Before = warship1.health();
    const health2Before = warship2.health();
    game.executeNextTick();

    // With port capacity of 1, only one warship should heal per tick
    const health1After = warship1.health();
    const health2After = warship2.health();

    // Both should get passive +1
    expect(health1After - health1Before).toBeGreaterThanOrEqual(1);
    expect(health2After - health2Before).toBeGreaterThanOrEqual(1);
    // Combined: both get +1 passive, only 1 gets bonus = max 3 total
    expect(
      health1After - health1Before + (health2After - health2Before),
    ).toBeLessThanOrEqual(3);
  });

  test("Port level 2 allows 2 warships to heal simultaneously", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 1;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    port.increaseLevel(); // Upgrade port to level 2
    expect(port.level()).toBe(2);

    const warship1 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    const warship2 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 10),
      {
        patrolTile: game.ref(coastX + 2, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship1));
    game.addExecution(new WarshipExecution(warship2));

    game.executeNextTick();
    warship1.modifyHealth(-700);
    warship2.modifyHealth(-700);
    executeTicks(game, 30);

    // Both warships are retreating to the port
    expect(warship1.retreating()).toBe(true);
    expect(warship2.retreating()).toBe(true);

    const health1Before = warship1.health();
    const health2Before = warship2.health();
    game.executeNextTick();

    // With level 2 port (capacity 2), both warships should heal
    const health1After = warship1.health();
    const health2After = warship2.health();

    // Both should get healing (1 base + 1 bonus = 2 HP)
    expect(health1After - health1Before).toBeGreaterThan(0);
    expect(health2After - health2Before).toBeGreaterThan(0);
  });

  test("Port level determines max healing capacity", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 2;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship1 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship1));

    game.executeNextTick();
    const damageAmount = maxHealth - 100;
    warship1.modifyHealth(-damageAmount);

    // Heal for several ticks while at level 1
    executeTicks(game, 20);

    // Upgrade port to level 2
    port.increaseLevel();
    expect(port.level()).toBe(2);

    // Continue healing at level 2
    const healthBeforeLevel2 = warship1.health();
    executeTicks(game, 1);
    const healthAfterOneTickLevel2 = warship1.health();

    // Level 2 doesn't change the healing amount per ship (still 1 base + 2 bonus)
    // It only allows more ships to heal, not faster healing per ship
    expect(healthAfterOneTickLevel2 - healthBeforeLevel2).toBe(3); // 1 + 2 = 3 HP/tick
  });

  test("Warship heals correctly when port is deleted and rebuilt", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 1;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const portTile = game.ref(coastX, 10);
    let port = player1.buildUnit(UnitType.Port, portTile, {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-100);
    executeTicks(game, 10);

    const healthBeforeDelete = warship.health();

    // Delete port
    port.delete();
    game.executeNextTick();

    // Warship should no longer heal
    const healthAfterDeleteBeforeRebuild = warship.health();
    expect(healthAfterDeleteBeforeRebuild).toBe(healthBeforeDelete);

    // Rebuild port at same location
    port = player1.buildUnit(UnitType.Port, portTile, {});
    game.executeNextTick();

    // Warship should start healing again
    expect(warship.health()).toBeGreaterThan(healthAfterDeleteBeforeRebuild);
  });

  test("Warship with multiple ports chooses nearest for healing", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 1;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const farPort = player1.buildUnit(UnitType.Port, game.ref(coastX, 5), {});
    const nearPort = player1.buildUnit(UnitType.Port, game.ref(coastX, 15), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 15),
      {
        patrolTile: game.ref(coastX + 1, 15),
      },
    );

    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 30);

    // Warship should retreat to nearest port
    // nearPort is at (coastX, 15), farPort is at (coastX, 5)
    // warship starts at (coastX+1, 15), so it's closer to nearPort
    const reachedNearPort =
      warship.tile() === nearPort.tile() ||
      warship.targetTile() === nearPort.tile();
    const reachedFarPort =
      warship.tile() === farPort.tile() ||
      warship.targetTile() === farPort.tile();

    // Should head to nearPort not farPort
    expect(reachedNearPort || !reachedFarPort).toBe(true);
  });

  test("Warship does not overheal above max health", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 5;
    game.config().warshipPortHealingRadius = () => 30;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-3); // Leave warship near max health
    game.executeNextTick();

    // Warship should not exceed max health
    expect(warship.health()).toBeLessThanOrEqual(maxHealth);
  });

  test("Three warships healing from level 2 port results in capacity overflow", async () => {
    game.config().warshipPortHealingBonus = () => 1;
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    port.increaseLevel(); // Level 2 = capacity 2
    expect(port.level()).toBe(2);

    const warship1 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    const warship2 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 10),
      {
        patrolTile: game.ref(coastX + 2, 10),
      },
    );
    const warship3 = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 3, 10),
      {
        patrolTile: game.ref(coastX + 3, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship1));
    game.addExecution(new WarshipExecution(warship2));
    game.addExecution(new WarshipExecution(warship3));

    game.executeNextTick();
    warship1.modifyHealth(-700);
    warship2.modifyHealth(-700);
    warship3.modifyHealth(-700);
    executeTicks(game, 30);

    expect(warship1.retreating()).toBe(true);
    expect(warship2.retreating()).toBe(true);
    expect(warship3.retreating()).toBe(true);

    const health1Before = warship1.health();
    const health2Before = warship2.health();
    const health3Before = warship3.health();

    game.executeNextTick();

    const health1After = warship1.health();
    const health2After = warship2.health();
    const health3After = warship3.health();

    const totalHealed =
      health1After -
      health1Before +
      (health2After - health2Before) +
      (health3After - health3Before);

    // All 3 warships get passive +1 = +3
    // Port capacity allows 2 warships bonus = +2
    // Total max = 5 HP per tick
    expect(totalHealed).toBeLessThanOrEqual(5);
  });

  test("HealAtPortExecution moves warship to port", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    // Execute one tick for the HealAtPortExecution to initialize
    game.executeNextTick();

    // Check that patrolTile and targetTile were set
    expect(warship.patrolTile()).toBe(portTile);
    expect(warship.targetTile()).toBe(portTile);
    expect(warship.retreating()).toBe(true);
  });

  test("HealAtPortExecution heals warship at port", async () => {
    game.config().warshipPortHealingBonus = () => 5;
    game.config().warshipPortHealingRadius = () => 30;

    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX, 10);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    game.executeNextTick();
    warship.modifyHealth(-100); // Damage the warship
    const healthBefore = warship.health();

    executeTicks(game, 3); // Let it heal

    const healthAfter = warship.health();
    expect(healthAfter).toBeGreaterThan(healthBefore);
  });

  test("HealAtPortExecution works even if warship at full health", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    const maxHealth = warship.health();

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    // Execute one tick to initialize
    game.executeNextTick();

    // Verify that HealAtPortExecution set the target correctly
    expect(warship.patrolTile()).toBe(portTile);
    expect(warship.targetTile()).toBe(portTile);
    expect(warship.retreating()).toBe(true);

    // Execute several more ticks
    executeTicks(game, 50);

    // Health shouldn't exceed max
    expect(warship.health()).toBeLessThanOrEqual(maxHealth);
  });

  test("HealAtPortExecution allows directing to any port location", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player2.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    // Execute one tick to initialize
    game.executeNextTick();

    // Warship should be directed to the port (even though it's enemy-owned)
    expect(warship.patrolTile()).toBe(portTile);
    expect(warship.targetTile()).toBe(portTile);
    expect(warship.retreating()).toBe(true);
  });

  test("HealAtPortExecution allows directing to any port location", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player2.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    // Execute one tick to initialize
    game.executeNextTick();

    // Warship should be directed to the port (even though it's enemy-owned)
    expect(warship.patrolTile()).toBe(portTile);
    expect(warship.targetTile()).toBe(portTile);
    expect(warship.retreating()).toBe(true);
  });

  test("Warship docks when reaching port tile", async () => {
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    const execution = new WarshipExecution(warship);
    game.addExecution(execution);

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 30);

    // Warship should be docked when it reaches the port
    expect(warship.retreating()).toBe(true);
    expect(execution.isDocked()).toBe(true);
  });

  test("Docked warship cannot move", async () => {
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    const execution = new WarshipExecution(warship);
    game.addExecution(execution);

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 30);

    const dockedTile = warship.tile();
    expect(execution.isDocked()).toBe(true);

    // Execute more ticks - warship should stay at same location while docked
    executeTicks(game, 10);
    expect(warship.tile()).toBe(dockedTile);
  });
});
