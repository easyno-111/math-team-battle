// Canvas scene for the gourd battle. Pure rendering and timing; it never decides game outcomes.
// Feed it team states (setTeams) and volley events (pushEvent) and it animates what happened.
import { TEAM_IDS, TEAM_META } from "../game/teams.js";
import { SQUAD_SIZE, UNIT_META, unitLabel } from "../game/rules.js";
import { drawGourd, drawShard, drawTierMark, drawUnit, SPRITE_H, unitPalette } from "./sprites.js";
import { createParticles } from "./particles.js";
import { getTintedAsset, getAsset, loadAssets } from "./assets.js";

export const ARENA_W = 960;
export const ARENA_H = 540;
const GROUND_Y = 486;
const GOURD_Y = 150;
const SPAWN_DELAY = 0.32;
const STAGGER = 0.045;

const FLIGHT = { warrior: 0.28, archer: 0.42, mage: 0.36, healer: 0.55, paladin: 0.5 };
const HIT_STOP = [0, 0.045, 0.085, 0.14];
const SHAKE = [0, 5, 9, 16];

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function easeOut(t) { return 1 - (1 - t) ** 3; }

function stageFor(ratio) {
  if (ratio > 0.66) return 0;
  if (ratio > 0.33) return 1;
  if (ratio > 0.12) return 2;
  return 3;
}

export function createArena(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  const particles = createParticles();
  const reducedMotion = Boolean(options.reducedMotion);
  let lanes = [];
  let laneById = new Map();
  let frame = 0;
  let last = 0;
  let running = false;
  let hitStop = 0;
  let shake = { x: 0, y: 0, power: 0 };
  let flash = 0;
  let winner = null;
  let winnerAt = 0;
  let timeNow = 0;
  let assetsReady = false;
  const projectiles = [];
  const floaters = [];
  const schedule = [];
  const shards = [];

  loadAssets(() => { assetsReady = true; });

  function layout(teamIds) {
    const count = Math.max(1, teamIds.length);
    const laneWidth = ARENA_W / count;
    lanes = teamIds.map((id, index) => {
      const existing = laneById.get(id);
      const cx = laneWidth * index + laneWidth / 2;
      const px = count >= 4 ? 4 : 5;
      const gourdSize = count >= 4 ? 96 : count === 3 ? 116 : 136;
      return {
        id, index, cx, laneWidth, px, gourdSize,
        meta: TEAM_META[id],
        hp: existing?.hp ?? 1, maxHp: existing?.maxHp ?? 1, targetHp: existing?.targetHp ?? 1,
        shield: existing?.shield ?? 0, targetShield: existing?.targetShield ?? 0,
        lastImpactAt: existing?.lastImpactAt ?? -10, squash: 1, squashVel: 0, hpFlash: 0,
        units: existing?.units ?? [], crowd: existing?.crowd ?? 0, burst: existing?.burst ?? false,
        rope: 0, ropeVel: 0, members: existing?.members ?? [], caption: null,
      };
    });
    laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    lanes.forEach((lane) => lane.units.forEach((unit, index) => placeUnit(lane, unit, index, lane.units.length)));
  }

  // Front row fills first; each row is centered on the pole so a small squad never hugs one side.
  function slotFor(lane, index, total) {
    const perRow = Math.ceil(SQUAD_SIZE / 2);
    const row = index < perRow ? 1 : 0;
    const col = index % perRow;
    const inRow = row === 1 ? Math.min(total, perRow) : total - perRow;
    const spacing = Math.min(lane.laneWidth / (perRow + 1), lane.px * 9);
    const x = lane.cx + (col - (inRow - 1) / 2) * spacing + (row === 0 ? spacing * 0.5 : 0);
    const y = GROUND_Y - row * lane.px * 9;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function placeUnit(lane, unit, index, total) {
    const slot = slotFor(lane, index, total);
    unit.targetX = slot.x;
    unit.targetY = slot.y;
    if (unit.x === undefined) { unit.x = slot.x; unit.y = slot.y; }
  }

  function addUnit(lane, unitData, dropIn) {
    const unit = { cls: unitData.cls, tier: Number(unitData.tier) || 1, phase: Math.random() * Math.PI * 2, hop: 0, hopVel: 0, attackT: 0, flip: Math.random() < 0.5 };
    lane.units.push(unit);
    while (lane.units.length > SQUAD_SIZE) { lane.units.shift(); lane.crowd += 1; }
    lane.units.forEach((item, index) => placeUnit(lane, item, index, lane.units.length));
    if (dropIn) {
      unit.y = unit.targetY - 140;
      unit.x = unit.targetX;
      unit.hopVel = 0;
      particles.burst({ x: unit.x, y: unit.targetY, count: 10, speed: 70, color: "#e9d8b8", size: 3, angle: -Math.PI / 2, spread: Math.PI, gravity: 400 });
    }
  }

  // Authoritative state. Called on every snapshot; animations in flight take priority briefly.
  function setTeams(teams, members = {}) {
    const ids = TEAM_IDS.filter((id) => teams[id]);
    if (ids.join() !== lanes.map((lane) => lane.id).join()) layout(ids);
    for (const lane of lanes) {
      const team = teams[lane.id];
      lane.maxHp = Math.max(1, Number(team.maxHp) || 1);
      lane.targetHp = clamp(Number(team.hp) || 0, 0, lane.maxHp);
      lane.targetShield = Number(team.shield) || 0;
      lane.members = members[lane.id] || [];
      const squad = Array.isArray(team.squad) ? team.squad : Object.values(team.squad || {});
      const summoned = Number(team.summoned) || 0;
      const known = lane.crowd + lane.units.length;
      if (known === 0 && (squad.length || summoned)) {
        // Fresh mount: materialize the current squad without animation.
        squad.forEach((unit) => addUnit(lane, unit, false));
        lane.crowd = Math.max(0, summoned - squad.length);
        lane.hp = lane.targetHp;
        lane.shield = lane.targetShield;
      } else if (summoned > known) {
        // Missed events (reconnect): append the units we never saw.
        squad.slice(-(summoned - known)).forEach((unit) => addUnit(lane, unit, false));
      }
      if (team.hp === 0 && !lane.burst && timeNow - lane.lastImpactAt > 2) burstGourd(lane, false);
    }
  }

  function pushEvent(event) {
    const lane = laneById.get(event.team);
    if (!lane || !event.unit) return;
    const t0 = timeNow;
    schedule.push({ at: t0, run: () => addUnit(lane, event.unit, true) });
    const squadAfter = [...lane.units.map((u) => ({ cls: u.cls, tier: u.tier })), event.unit].slice(-SQUAD_SIZE);
    const attackers = squadAfter.filter((unit) => UNIT_META[unit.cls]?.role === "attack");
    const supporters = squadAfter.filter((unit) => UNIT_META[unit.cls]?.role !== "attack");
    const maxTier = Math.max(1, ...squadAfter.map((u) => u.tier), Number(event.unit.tier) || 1);
    const volleyAt = t0 + SPAWN_DELAY;
    const lastImpact = { time: 0 };
    attackers.forEach((unit, index) => {
      const fireAt = volleyAt + index * STAGGER;
      schedule.push({ at: fireAt, run: () => fireProjectile(lane, unit, index === attackers.length - 1 ? { final: true, event } : null) });
      lastImpact.time = Math.max(lastImpact.time, fireAt + FLIGHT[unit.cls]);
    });
    if (!attackers.length) {
      // Base damage still lands: the summoned supporter throws a plain stone.
      schedule.push({ at: volleyAt, run: () => fireProjectile(lane, { cls: "stone", tier: 1 }, { final: true, event }) });
      lastImpact.time = volleyAt + 0.35;
    }
    const rival = event.heal?.team || event.shieldGiven?.team;
    const rivalLane = rival ? laneById.get(rival) : null;
    if (rivalLane) {
      supporters.forEach((unit, index) => {
        const role = UNIT_META[unit.cls]?.role;
        if (role === "heal" && event.heal) schedule.push({ at: volleyAt + index * STAGGER, run: () => fireSupport(lane, rivalLane, unit, index === 0 ? event.heal : null, "heal") });
        if (role === "shield" && event.shieldGiven) schedule.push({ at: volleyAt + index * STAGGER, run: () => fireSupport(lane, rivalLane, unit, index === 0 ? event.shieldGiven : null, "shield") });
      });
    }
    lane.lastImpactAt = Math.max(lane.lastImpactAt, lastImpact.time + 1.2);
    void maxTier;
  }

  function unitOrigin(lane, unitData) {
    const live = lane.units.find((u) => u.cls === unitData.cls && u.tier === unitData.tier && !u.busy) || lane.units[lane.units.length - 1];
    if (live) { live.attackT = 1; live.busy = true; setTimeout(() => { live.busy = false; }, 200); }
    return { x: live?.x ?? lane.cx, y: (live?.y ?? GROUND_Y) - SPRITE_H * lane.px * 0.6 };
  }

  function fireProjectile(lane, unitData, payload) {
    const from = unitOrigin(lane, unitData);
    const to = { x: lane.cx + (Math.random() - 0.5) * lane.gourdSize * 0.5, y: GOURD_Y + (Math.random() - 0.5) * lane.gourdSize * 0.4 };
    projectiles.push({ kind: unitData.cls, tier: Number(unitData.tier) || 1, lane, from, to, t: 0, duration: FLIGHT[unitData.cls] || 0.35, payload, wobble: Math.random() * Math.PI * 2 });
  }

  function fireSupport(lane, rivalLane, unitData, payload, kind) {
    const from = unitOrigin(lane, unitData);
    const to = { x: rivalLane.cx, y: GOURD_Y };
    projectiles.push({ kind, tier: Number(unitData.tier) || 1, lane: rivalLane, from, to, t: 0, duration: FLIGHT[unitData.cls] || 0.5, payload, wobble: Math.random() * Math.PI * 2, support: true });
  }

  function impact(projectile) {
    const { lane, to, tier, kind, payload } = projectile;
    const meta = lane.meta;
    if (kind === "heal") {
      particles.burst({ x: to.x, y: to.y, count: 14 + tier * 6, speed: 90, colors: ["#8be78b", "#d9ffd9", "#ffffff"], size: 3, gravity: -120, decay: 1.2 });
      if (payload) {
        lane.hp = clamp(lane.hp + payload.amount, 0, lane.maxHp);
        floaters.push({ x: to.x + (Math.random() - 0.5) * 40, y: to.y - lane.gourdSize / 2, text: `+${payload.amount}`, color: "#3fa75f", life: 1.1, size: 22 });
      }
      return;
    }
    if (kind === "shield") {
      particles.burst({ x: to.x, y: to.y, count: 18, speed: 120, colors: ["#ffdd66", "#fff6cc"], size: 3, gravity: 0, decay: 1.6 });
      if (payload) { lane.shield += payload.charges; floaters.push({ x: to.x + (Math.random() - 0.5) * 40, y: to.y - lane.gourdSize / 2 - 8, text: "수호!", color: "#c79a1a", life: 1.1, size: 20 }); }
      return;
    }
    const power = tier;
    const hue = [meta.color, meta.light, "#ffffff", "#ffd166"];
    particles.burst({ x: to.x, y: to.y, count: 14 + power * 12, speed: 160 + power * 90, colors: hue, size: 3 + power, gravity: 700, decay: 1.5 });
    particles.burst({ x: to.x, y: to.y, count: 6 + power * 4, speed: 60, colors: ["#fff3b0", "#ffffff"], size: 2, gravity: 0, decay: 2.4 });
    lane.squashVel -= 2.6 + power * 1.2;
    lane.ropeVel += (Math.random() - 0.5) * 6;
    lane.hpFlash = 1;
    if (!reducedMotion) { shake.power = Math.max(shake.power, SHAKE[power] * 0.5); }
    if (payload?.final && payload.event) {
      const event = payload.event;
      lane.hp = clamp(Number(event.hpAfter) || 0, 0, lane.maxHp);
      if (event.shieldUsed) {
        lane.shield = Math.max(0, lane.shield - 1);
        particles.burst({ x: lane.cx, y: GOURD_Y, count: 30, speed: 200, colors: ["#ffdd66", "#ffffff"], size: 4, gravity: 300, decay: 1.4 });
        floaters.push({ x: lane.cx, y: GOURD_Y - lane.gourdSize / 2 - 26, text: "방어!", color: "#c79a1a", life: 1.1, size: 20 });
      }
      floaters.push({ x: to.x + (Math.random() - 0.5) * 50, y: to.y - 10, text: `-${event.damage}`, color: event.damage >= 20 ? "#d94a4a" : "#b33a3a", life: 1.2, size: event.damage >= 20 ? 34 : 26, bold: true });
      const unitTier = Number(event.unit?.tier) || 1;
      if (!reducedMotion) {
        hitStop = Math.max(hitStop, HIT_STOP[Math.min(3, unitTier)] + Math.min(0.08, event.damage / 400));
        shake.power = Math.max(shake.power, SHAKE[Math.min(3, unitTier)] + Math.min(10, event.damage / 4));
      }
      if (unitTier >= 2) flash = Math.max(flash, unitTier >= 3 ? 0.55 : 0.3);
      lane.caption = { text: `${event.attackerName} · ${unitLabel(event.unit)}${event.streak >= 2 ? ` · ${event.streak}연속` : ""}`, life: 2.2 };
      if (event.burst || lane.hp <= 0) burstGourd(lane, true);
    }
  }

  function burstGourd(lane, animated) {
    if (lane.burst) return;
    lane.burst = true;
    lane.hp = 0;
    winner = winner || lane.id;
    winnerAt = timeNow;
    const { color, dark, light } = lane.meta;
    if (!animated) return;
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index / 10 - 0.5) * Math.PI * 1.4;
      shards.push({ x: lane.cx, y: GOURD_Y, vx: Math.cos(angle) * (160 + Math.random() * 160), vy: Math.sin(angle) * (220 + Math.random() * 160), size: 10 + Math.random() * 12, rotation: Math.random() * 6, spin: (Math.random() - 0.5) * 8, color: index % 2 ? color : light, dark, life: 2.4 });
    }
    particles.burst({ x: lane.cx, y: GOURD_Y, count: 120, speed: 360, colors: [color, light, "#ffffff", "#ffd166", "#ff7b54"], size: 5, gravity: 500, decay: 0.9 });
    for (let index = 0; index < 90; index += 1) {
      particles.spawn({ x: lane.cx + (Math.random() - 0.5) * lane.laneWidth, y: -20 - Math.random() * 300, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 90, color: [color, light, "#ffd166", "#ffffff", "#8be78b"][index % 5], size: 4 + Math.random() * 3, gravity: 20, decay: 0.28, drag: 0.995, shrink: false });
    }
    if (!reducedMotion) { hitStop = Math.max(hitStop, 0.18); shake.power = Math.max(shake.power, 26); }
    flash = Math.max(flash, 0.8);
  }

  function update(dt) {
    timeNow += dt;
    while (schedule.length && schedule[0].at <= timeNow) schedule.shift().run();
    schedule.sort((a, b) => a.at - b.at);
    if (hitStop > 0) { hitStop -= dt; particles.update(dt * 0.15); return; }
    for (const lane of lanes) {
      // catch up to authoritative values once animations are quiet
      if (timeNow > lane.lastImpactAt) {
        lane.hp = Math.abs(lane.hp - lane.targetHp) < 0.6 ? lane.targetHp : lerp(lane.hp, lane.targetHp, 1 - Math.exp(-dt * 4));
        lane.shield = lane.targetShield;
        if (lane.targetHp === 0 && !lane.burst) burstGourd(lane, true);
      }
      lane.squashVel += (1 - lane.squash) * 180 * dt;
      lane.squashVel *= Math.exp(-dt * 9);
      lane.squash = clamp(lane.squash + lane.squashVel * dt, 0.55, 1.35);
      lane.ropeVel += -lane.rope * 30 * dt;
      lane.ropeVel *= Math.exp(-dt * 3);
      lane.rope += lane.ropeVel * dt;
      lane.hpFlash = Math.max(0, lane.hpFlash - dt * 3);
      if (lane.caption) { lane.caption.life -= dt; if (lane.caption.life <= 0) lane.caption = null; }
      for (const unit of lane.units) {
        unit.x = lerp(unit.x, unit.targetX, 1 - Math.exp(-dt * 7));
        if (unit.y < unit.targetY) { unit.hopVel += 900 * dt; unit.y = Math.min(unit.targetY, unit.y + unit.hopVel * dt); if (unit.y === unit.targetY) unit.hopVel = 0; }
        else unit.y = unit.targetY;
        unit.attackT = Math.max(0, unit.attackT - dt * 5);
        unit.phase += dt * (2.2 + unit.tier * 0.4);
      }
    }
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const p = projectiles[index];
      p.t += dt / p.duration;
      if (p.t >= 1) { projectiles.splice(index, 1); impact(p); continue; }
      const pos = projectilePosition(p);
      if (p.kind === "mage" || p.support) particles.spawn({ x: pos.x, y: pos.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, color: p.support ? (p.kind === "heal" ? "#9df09d" : "#ffe08a") : "#c9b8ff", size: 2 + p.tier, gravity: 0, decay: 3 });
      else if (p.tier >= 2) particles.spawn({ x: pos.x, y: pos.y, vx: 0, vy: 0, color: p.lane.meta.light, size: 2 + p.tier, gravity: 0, decay: 4 });
    }
    for (let index = shards.length - 1; index >= 0; index -= 1) {
      const s = shards[index];
      s.life -= dt; if (s.life <= 0) { shards.splice(index, 1); continue; }
      s.vy += 700 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rotation += s.spin * dt;
      if (s.y > GROUND_Y) { s.y = GROUND_Y; s.vy *= -0.35; s.vx *= 0.6; s.spin *= 0.5; }
    }
    for (let index = floaters.length - 1; index >= 0; index -= 1) {
      const f = floaters[index];
      f.life -= dt; f.y -= dt * 28;
      if (f.life <= 0) floaters.splice(index, 1);
    }
    particles.update(dt);
    shake.power *= Math.exp(-dt * 6);
    shake.x = (Math.random() - 0.5) * shake.power;
    shake.y = (Math.random() - 0.5) * shake.power;
    flash = Math.max(0, flash - dt * 2.2);
  }

  function projectilePosition(p) {
    const t = easeOut(clamp(p.t, 0, 1));
    const x = lerp(p.from.x, p.to.x, t);
    const arc = p.kind === "archer" ? 90 : p.support ? 120 : p.kind === "mage" ? 40 : 10;
    const y = lerp(p.from.y, p.to.y, t) - Math.sin(t * Math.PI) * arc + (p.kind === "mage" ? Math.sin(p.wobble + p.t * 18) * 6 : 0);
    return { x, y };
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, ARENA_H);
    sky.addColorStop(0, "#fff7e8"); sky.addColorStop(0.7, "#f6ebd6"); sky.addColorStop(1, "#e8dcc1");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    const ground = getAsset("ground");
    if (ground) ctx.drawImage(ground, 0, GROUND_Y - 6, ARENA_W, ARENA_H - GROUND_Y + 6);
    else {
      ctx.fillStyle = "#cfc39f"; ctx.fillRect(0, GROUND_Y - 4, ARENA_W, 4);
      ctx.fillStyle = "#b9ad87"; ctx.fillRect(0, GROUND_Y, ARENA_W, ARENA_H - GROUND_Y);
      ctx.fillStyle = "#a89c78";
      for (let x = 0; x < ARENA_W; x += 24) ctx.fillRect(x + (Math.floor(x / 24) % 2) * 6, GROUND_Y + 14, 10, 4);
    }
    lanes.forEach((lane, index) => {
      if (index === 0) return;
      ctx.fillStyle = "rgba(90, 70, 60, 0.12)";
      ctx.fillRect(Math.round(lane.cx - lane.laneWidth / 2) - 1, 60, 2, GROUND_Y - 60);
    });
  }

  function drawLane(lane) {
    const { cx, meta, gourdSize } = lane;
    const ratio = lane.hp / lane.maxHp;
    // pole and rope
    const pole = getAsset("pole");
    const poleX = Math.round(cx);
    if (pole) ctx.drawImage(pole, poleX - pole.naturalWidth / 2, 40, pole.naturalWidth, GROUND_Y - 40);
    else {
      ctx.fillStyle = "#8a6a4a"; ctx.fillRect(poleX - 3, 40, 6, GROUND_Y - 40);
      ctx.fillStyle = "#6b4f33"; ctx.fillRect(poleX - 22, 40, 44, 6);
    }
    const swing = Math.sin(lane.rope) * 6;
    const gx = cx + swing, gy = GOURD_Y;
    ctx.strokeStyle = "#6b4f33"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(poleX, 46); ctx.lineTo(gx, gy - gourdSize / 2 - 10); ctx.stroke();
    // team label
    ctx.fillStyle = meta.dark; ctx.font = "900 15px 'Pretendard', 'Noto Sans KR', sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${lane.id} · ${meta.short}`, cx, 28);
    if (!lane.burst) {
      const stage = stageFor(ratio);
      const asset = getTintedAsset(`gourd-${stage + 1}`, meta.color);
      if (asset) {
        const w = gourdSize * 1.15, h = w * (asset.height / asset.width);
        ctx.save(); ctx.translate(gx, gy); ctx.scale(1 / lane.squash, lane.squash);
        ctx.drawImage(asset, -w / 2, -h / 2, w, h); ctx.restore();
        if (lane.shield > 0) drawGourd(ctx, { x: gx, y: gy, size: 0, color: meta.color, dark: meta.dark, light: meta.light, shield: lane.shield, squash: 1 });
      } else {
        drawGourd(ctx, { x: gx, y: gy, size: gourdSize, color: meta.color, dark: meta.dark, light: meta.light, stage, shield: lane.shield, squash: lane.squash });
      }
      if (lane.shield > 0) {
        ctx.fillStyle = "#c79a1a"; ctx.font = "900 12px sans-serif";
        ctx.fillText(`수호 ×${lane.shield}`, gx, gy + gourdSize / 2 + 26);
      }
    }
    // hp bar
    const barW = Math.min(lane.laneWidth - 40, 190), barH = 14, bx = Math.round(cx - barW / 2), by = GOURD_Y + gourdSize / 2 + 34;
    ctx.fillStyle = "#2c2430"; ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    ctx.fillStyle = "#5a4a4a"; ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = lane.hpFlash > 0 ? "#ffffff" : ratio > 0.5 ? meta.color : ratio > 0.2 ? "#e0a24a" : "#d94a4a";
    ctx.fillRect(bx, by, Math.round(barW * clamp(ratio, 0, 1)), barH);
    ctx.fillStyle = "#2c2430"; ctx.font = "900 12px sans-serif";
    ctx.fillText(`${Math.round(lane.hp)} / ${lane.maxHp}`, cx, by + barH + 14);
    // units
    for (const unit of lane.units) {
      const bob = Math.sin(unit.phase) * 1.2;
      const lunge = unit.attackT * 6;
      const palette = unitPalette(unit.cls, unit.tier, meta.color, meta.dark);
      const x = Math.round(unit.x), y = Math.round(unit.y + bob - lunge);
      ctx.fillStyle = "rgba(60, 40, 30, 0.18)"; ctx.fillRect(x - lane.px * 3, Math.round(unit.targetY) - 1, lane.px * 6, 2);
      drawUnit(ctx, { cls: unit.cls, x, y, px: lane.px, palette, flip: unit.flip });
      drawTierMark(ctx, { tier: unit.tier, x, y, px: lane.px });
    }
    if (lane.caption) {
      ctx.globalAlpha = clamp(lane.caption.life * 1.5, 0, 1);
      ctx.font = "800 13px 'Pretendard', 'Noto Sans KR', sans-serif";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,250,240,0.95)"; ctx.strokeText(lane.caption.text, cx, GROUND_Y - lane.px * 9 - SPRITE_H * lane.px - 18);
      ctx.fillStyle = meta.dark; ctx.fillText(lane.caption.text, cx, GROUND_Y - lane.px * 9 - SPRITE_H * lane.px - 18);
      ctx.globalAlpha = 1;
    }
    if (lane.crowd > 0) {
      ctx.fillStyle = meta.dark; ctx.font = "800 11px sans-serif";
      ctx.fillText(`+${lane.crowd} 응원단`, cx, GROUND_Y + 34);
    }
  }

  function drawProjectile(p) {
    const pos = projectilePosition(p);
    const color = p.lane.meta.color;
    const size = 3 + p.tier * 2;
    ctx.save();
    ctx.translate(Math.round(pos.x), Math.round(pos.y));
    const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y - 60;
    const angle = Math.atan2(dy, dx);
    if (p.kind === "warrior") {
      ctx.rotate(angle);
      ctx.fillStyle = "#e9f2ff";
      for (let i = -2; i <= 2; i += 1) ctx.fillRect(i * size, -Math.abs(i) * size * 0.8 - size, size, size * 2);
      ctx.fillStyle = color; ctx.fillRect(-size * 2, -size * 2.2, size * 5, size * 0.7);
    } else if (p.kind === "archer") {
      ctx.rotate(angle);
      ctx.fillStyle = "#6b4f33"; ctx.fillRect(-size * 3, -1, size * 5, 2 + p.tier);
      ctx.fillStyle = "#dfe6ee"; ctx.fillRect(size * 2, -size * 0.7, size, size * 1.4);
      ctx.fillStyle = color; ctx.fillRect(-size * 3, -size * 0.7, size * 0.8, size * 1.4);
    } else if (p.kind === "mage") {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = "#7f6ad8"; ctx.fillRect(-size, 0, size, size); ctx.fillRect(0, -size, size, size);
      ctx.fillStyle = color; ctx.fillRect(-size * 1.5, -size * 0.5, size, size); ctx.fillRect(size * 0.5, -size * 0.5, size, size);
    } else if (p.kind === "heal") {
      ctx.fillStyle = "#8be78b"; ctx.fillRect(-size / 2, -size * 1.5, size, size * 3); ctx.fillRect(-size * 1.5, -size / 2, size * 3, size);
    } else if (p.kind === "shield") {
      ctx.fillStyle = "#ffdd66"; ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = "#8c8c8c"; ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (!winner) return;
    const lane = laneById.get(winner);
    if (!lane) return;
    const t = clamp((timeNow - winnerAt) / 0.8, 0, 1);
    const height = easeOut(t) * 150;
    const width = Math.min(lane.laneWidth - 30, 220);
    const x = Math.round(lane.cx - width / 2), y = GOURD_Y - 40;
    const banner = getAsset("banner");
    if (banner) ctx.drawImage(banner, x, y, width, height * 1.1);
    else {
      ctx.fillStyle = "#fff8e6"; ctx.fillRect(x, y, width, height);
      ctx.fillStyle = lane.meta.color; ctx.fillRect(x, y, width, 8); ctx.fillRect(x, y + height - 8, width, 8);
      ctx.fillStyle = "#2c2430"; ctx.fillRect(x - 4, y, 4, height); ctx.fillRect(x + width, y, 4, height);
    }
    if (t > 0.6) {
      ctx.textAlign = "center";
      ctx.fillStyle = lane.meta.dark; ctx.font = `900 ${Math.round(Math.min(64, width / 3.4))}px 'Pretendard', sans-serif`;
      ctx.fillText("WIN", lane.cx, y + height * 0.55);
      ctx.fillStyle = "#2c2430"; ctx.font = "900 16px 'Pretendard', sans-serif";
      ctx.fillText(`${lane.meta.label} 승리!`, lane.cx, y + height * 0.85);
    }
  }

  function render() {
    const scale = canvas.width / ARENA_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    ctx.save();
    ctx.translate(Math.round(shake.x), Math.round(shake.y));
    drawBackground();
    lanes.forEach(drawLane);
    projectiles.forEach(drawProjectile);
    shards.forEach((s) => drawShard(ctx, s));
    particles.draw(ctx);
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.font = `${f.bold ? 900 : 800} ${f.size}px 'Pretendard', 'Noto Sans KR', sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,250,240,0.9)"; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    drawBanner();
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = `rgba(255, 240, 200, ${flash * 0.5})`; ctx.fillRect(0, 0, ARENA_W, ARENA_H); }
  }

  function loop(timestamp) {
    if (!running) return;
    const dt = Math.min(0.05, last ? (timestamp - last) / 1000 : 0.016);
    last = timestamp;
    update(dt);
    render();
    frame = requestAnimationFrame(loop);
  }

  return {
    setTeams,
    pushEvent,
    get winner() { return winner; },
    get ready() { return assetsReady; },
    resize(width) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width * dpr * (ARENA_H / ARENA_W));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${(width * ARENA_H) / ARENA_W}px`;
      render();
    },
    start() { if (running) return; running = true; last = 0; frame = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(frame); },
    destroy() { this.stop(); particles.clear(); projectiles.length = 0; schedule.length = 0; floaters.length = 0; shards.length = 0; lanes = []; laneById = new Map(); },
  };
}
