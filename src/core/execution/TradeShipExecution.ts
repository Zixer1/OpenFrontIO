import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { findClosestBy } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private returning = false;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  private static _staggerCounter = 0;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger =
      TradeShipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(mg, stagger);
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      const shipCost = this.mg
        .config()
        .unitInfo(UnitType.TradeShip)
        .cost(this.mg, this.origOwner);
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      if (shipCost > 0n) {
        this.mg.addUpdate({
          type: GameUpdateType.BonusEvent,
          player: this.origOwner.id(),
          tile: this.srcPort.tile(),
          gold: -Number(shipCost),
          troops: 0,
        });
        this.mg.displayMessage(
          "events_display.trade_ship_purchased",
          MessageType.TRADE_SHIP_PURCHASED,
          this.origOwner.id(),
          shipCost,
          { gold: renderNumber(shipCost) },
        );
      }
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    // If source port is destroyed during return trip, delete the ship.
    if (this.returning && !this.srcPort.isActive()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const myComponent = this.mg.getWaterComponent(curTile);
      const nearestPort = findClosestBy(
        tradeShipOwner.units(UnitType.Port),
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          myComponent !== null &&
          this.mg.hasWaterComponent(port.tile(), myComponent),
      );
      if (nearestPort === null) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeShip.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeShip.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const dst = this.returning ? this.srcPort.tile() : this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.findPath(from, dst) ?? [from];
          if (path.length === 0 || path[0] !== from) {
            path.unshift(from);
          }

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.COMPLETE:
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  private complete() {
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured) {
      // Captured ships: deliver cargo + ship scrap value, then despawn
      const shipCost = Number(
        this.mg
          .config()
          .unitInfo(UnitType.TradeShip)
          .cost(this.mg, this.tradeShip!.owner()),
      );
      const piracyGold = gold + BigInt(shipCost);
      this.tradeShip!.owner().addGold(piracyGold, this._dstPort.tile());
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        piracyGold,
        {
          gold: renderNumber(piracyGold),
          name: this.origOwner.displayName(),
        },
      );
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, piracyGold);
      this.active = false;
      this.tradeShip!.delete(false);
      return;
    }

    if (!this.returning) {
      // Outbound leg complete: deposit gold at destination
      this.srcPort.owner().addGold(gold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      this.mg.displayMessage(
        "events_display.received_gold_from_trade",
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this._dstPort.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.srcPort.owner().displayName(),
        },
      );
      this.mg.displayMessage(
        "events_display.received_gold_from_trade",
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this.srcPort.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this._dstPort.owner().displayName(),
        },
      );
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);

      // Start return leg
      this.returning = true;
      this.tilesTraveled = 0;
      this.motionPlanDst = null;
      // Swap target to source port for the return trip
      this.tradeShip!.setTargetUnit(this.srcPort);
      this.tradeShip!.touch();
    } else {
      // Return leg complete: deposit gold with 2x round trip bonus
      const bonusGold = gold * 2n;
      this.srcPort.owner().addGold(bonusGold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this.srcPort.tile());
      this.mg
        .stats()
        .boatArriveTrade(this._dstPort.owner(), this.srcPort.owner(), gold);
      // Replace generic trade messages with round trip bonus messages
      this.mg.displayMessage(
        "events_display.trade_ship_round_trip",
        MessageType.TRADE_SHIP_ROUND_TRIP,
        this.srcPort.owner().id(),
        bonusGold,
        {
          gold: renderNumber(bonusGold),
          name: this._dstPort.owner().displayName(),
        },
      );
      this.mg.displayMessage(
        "events_display.trade_ship_round_trip",
        MessageType.TRADE_SHIP_ROUND_TRIP,
        this._dstPort.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.srcPort.owner().displayName(),
        },
      );
      this.active = false;
      this.tradeShip!.delete(false);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this.returning ? this.srcPort.tile() : this._dstPort.tile();
  }
}
