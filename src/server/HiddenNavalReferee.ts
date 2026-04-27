import type {
  ClientID,
  HiddenNavalAction,
  HiddenNavalEvent,
} from "../core/Schemas";

/** Position of a hidden sea mine tracked only on the server. */
interface HiddenMine {
  id: number;
  ownerClientID: ClientID;
  tile: number;
}

/** Position of a submerged submarine tracked only on the server. */
interface SubmergedSub {
  unitId: number;
  ownerClientID: ClientID;
  tile: number;
}

/**
 * Server-side referee that privately tracks hidden naval objects
 * (submerged submarines and sea mines). Secret coordinates never
 * pass through the normal Turn.intents[] broadcast.
 *
 * The referee produces HiddenNavalEvent[] that ARE safe to broadcast
 * because they only reveal what players are allowed to know.
 */
export class HiddenNavalReferee {
  private mines = new Map<number, HiddenMine>();
  private submergedSubs = new Map<number, SubmergedSub>();
  private pendingEvents: HiddenNavalEvent[] = [];
  private nextMineId = 1;

  /** Process a private hidden naval action from an authenticated client. */
  handleAction(clientID: ClientID, action: HiddenNavalAction): void {
    switch (action.action) {
      case "place_mine":
        this.placeMine(clientID, action.tile);
        break;
      case "submerge_submarine":
        this.submergeSub(clientID, action.unitId);
        break;
      case "move_submerged_submarine":
        this.moveSubmergedSub(clientID, action.unitId, action.tile);
        break;
      case "surface_submarine":
        this.surfaceSub(clientID, action.unitId);
        break;
      case "sweep_mines":
        this.sweepMines(clientID, action.unitId, action.radius);
        break;
      case "activate_sonar":
        this.activateSonar(clientID, action.unitId, action.radius);
        break;
      case "launch_submarine_missile":
        this.launchMissile(
          clientID,
          action.unitId,
          action.targetTile,
          action.missileType,
        );
        break;
    }
  }

  /**
   * Check mine detonations against a set of known naval unit
   * positions. Called by the server each turn with the positions
   * of all warships/subs/transports determined from the public
   * game state (which the server can reconstruct from the turn
   * history, or receive from a lightweight tracker).
   *
   * For the minimal first version the server may delegate this
   * to the client simulation by having the SeaMineExecution
   * produce detonation events only for the mine owner's client,
   * and then the referee validates them. Alternatively the
   * server can run its own proximity check.
   */
  checkDetonations(
    navalUnits: Array<{
      unitId: number;
      ownerClientID: ClientID;
      tile: number;
      maxHealth: number;
    }>,
    triggerRange: number,
    damageRatio: number,
    distFn: (a: number, b: number) => number,
  ): void {
    const toRemove: number[] = [];
    for (const [mineId, mine] of this.mines) {
      for (const ship of navalUnits) {
        if (ship.ownerClientID === mine.ownerClientID) continue;
        const dist = distFn(mine.tile, ship.tile);
        if (dist <= triggerRange) {
          const damage = Math.floor(ship.maxHealth * damageRatio);
          this.pendingEvents.push({
            event: "mine_detonated",
            tile: mine.tile,
            ownerClientID: mine.ownerClientID,
            victimUnitId: ship.unitId,
            damage,
          });
          toRemove.push(mineId);
          break; // each mine detonates once
        }
      }
    }
    for (const id of toRemove) {
      this.mines.delete(id);
    }
  }

  /** Drain all pending events, clearing the buffer. */
  flushEvents(): HiddenNavalEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Get per-client mine positions (for the owner's private view). */
  getMinesForClient(clientID: ClientID): HiddenMine[] {
    return [...this.mines.values()].filter((m) => m.ownerClientID === clientID);
  }

  /** Get per-client submerged sub positions (for the owner's private view). */
  getSubsForClient(clientID: ClientID): SubmergedSub[] {
    return [...this.submergedSubs.values()].filter(
      (s) => s.ownerClientID === clientID,
    );
  }

  // -------------------------------------------------------------------
  // Private action handlers
  // -------------------------------------------------------------------

  private placeMine(clientID: ClientID, tile: number): void {
    const id = this.nextMineId++;
    this.mines.set(id, { id, ownerClientID: clientID, tile });
    this.pendingEvents.push({
      event: "mine_placed",
      ownerClientID: clientID,
      mineId: id,
      tile,
    });
  }

  private submergeSub(clientID: ClientID, unitId: number): void {
    // Only the owner can submerge their own sub
    this.submergedSubs.set(unitId, {
      unitId,
      ownerClientID: clientID,
      tile: 0, // will be set by the client's initial position
    });
    this.pendingEvents.push({
      event: "submarine_submerged",
      unitId,
      ownerClientID: clientID,
    });
  }

  private moveSubmergedSub(
    clientID: ClientID,
    unitId: number,
    tile: number,
  ): void {
    const sub = this.submergedSubs.get(unitId);
    if (!sub || sub.ownerClientID !== clientID) return;
    sub.tile = tile;
    // No public event — movement is secret
  }

  private surfaceSub(clientID: ClientID, unitId: number): void {
    const sub = this.submergedSubs.get(unitId);
    if (!sub || sub.ownerClientID !== clientID) return;
    this.pendingEvents.push({
      event: "submarine_surfaced",
      unitId,
      ownerClientID: clientID,
      tile: sub.tile,
    });
    this.submergedSubs.delete(unitId);
  }

  private sweepMines(
    clientID: ClientID,
    _unitId: number,
    radius: number,
  ): void {
    const sub = [...this.submergedSubs.values()].find(
      (s) => s.ownerClientID === clientID && s.unitId === _unitId,
    );
    if (!sub) return;

    let count = 0;
    const toRemove: number[] = [];
    for (const [mineId, mine] of this.mines) {
      if (mine.ownerClientID === clientID) continue; // don't sweep own mines
      // Simple manhattan-style check using tile index difference
      // For a proper implementation, use euclidean distance with map dimensions
      const dx = Math.abs((mine.tile % 10000) - (sub.tile % 10000));
      const dy = Math.abs(
        Math.floor(mine.tile / 10000) - Math.floor(sub.tile / 10000),
      );
      if (dx <= radius && dy <= radius) {
        toRemove.push(mineId);
        count++;
      }
    }
    for (const id of toRemove) {
      this.mines.delete(id);
    }
    if (count > 0) {
      this.pendingEvents.push({
        event: "mine_disarmed",
        ownerClientID: clientID,
        count,
      });
    }
  }

  private activateSonar(
    clientID: ClientID,
    _unitId: number,
    radius: number,
  ): void {
    const sub = [...this.submergedSubs.values()].find(
      (s) => s.ownerClientID === clientID && s.unitId === _unitId,
    );
    if (!sub) return;

    // Check for enemy mines in range
    for (const mine of this.mines.values()) {
      if (mine.ownerClientID === clientID) continue;
      const dx = Math.abs((mine.tile % 10000) - (sub.tile % 10000));
      const dy = Math.abs(
        Math.floor(mine.tile / 10000) - Math.floor(sub.tile / 10000),
      );
      if (dx <= radius && dy <= radius) {
        this.pendingEvents.push({
          event: "sonar_contact",
          detectorClientID: clientID,
          sectorTile: mine.tile,
          contactType: "mine",
        });
        break; // report sector-level, not exact positions
      }
    }

    // Check for enemy subs in range
    for (const enemySub of this.submergedSubs.values()) {
      if (enemySub.ownerClientID === clientID) continue;
      const dx = Math.abs((enemySub.tile % 10000) - (sub.tile % 10000));
      const dy = Math.abs(
        Math.floor(enemySub.tile / 10000) - Math.floor(sub.tile / 10000),
      );
      if (dx <= radius && dy <= radius) {
        this.pendingEvents.push({
          event: "sonar_contact",
          detectorClientID: clientID,
          sectorTile: enemySub.tile,
          contactType: "submarine",
        });
        break;
      }
    }
  }

  private launchMissile(
    clientID: ClientID,
    unitId: number,
    targetTile: number,
    missileType: string,
  ): void {
    const sub = this.submergedSubs.get(unitId);
    if (!sub || sub.ownerClientID !== clientID) return;

    // Launching reveals the sub
    this.pendingEvents.push({
      event: "submarine_revealed",
      unitId,
      ownerClientID: clientID,
      tile: sub.tile,
    });
    this.pendingEvents.push({
      event: "submarine_missile_launched",
      unitId,
      ownerClientID: clientID,
      tile: sub.tile,
      targetTile,
      missileType: missileType as (typeof UnitType)[keyof typeof UnitType],
    });

    // Sub surfaces after launching
    this.submergedSubs.delete(unitId);
  }
}

// Re-export UnitType reference for the missile type cast
import type { UnitType } from "../core/game/Game";
