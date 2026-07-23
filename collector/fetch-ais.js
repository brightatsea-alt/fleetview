/**
 * FleetView AIS Collector
 * AISStream.io WebSocket 구독 → 관리 MMSI 필터 → data/fleet.json 저장.
 * 이전 fleet.json을 이어받아 마지막 위치·최대속도(maxSog)를 보존한다.
 * 필요 환경변수: AISSTREAM_API_KEY
 */
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..");
const API_KEY = process.env.AISSTREAM_API_KEY;
const LISTEN_SECONDS = Number(process.env.LISTEN_SECONDS || 170);
const OUT = path.join(ROOT, "data", "fleet.json");
if (!API_KEY) { console.error("AISSTREAM_API_KEY 가 없습니다."); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "mmsi.json"), "utf8"));
const FLEET = cfg.vessels;
const MMSIS = FLEET.map(v => String(v.mmsi));
const byMmsi = Object.fromEntries(FLEET.map(v => [String(v.mmsi), v]));

// 이전 데이터 이어받기 (마지막 위치·maxSog 보존)
let store = {};
try {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  (prev.vessels || []).forEach(v => { store[String(v.mmsi)] = v; });
} catch (_) {}

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
ws.on("open", () => {
  ws.send(JSON.stringify({
    APIKey: API_KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: MMSIS,
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  }));
  console.log(`구독 시작 · 선박 ${MMSIS.length}척 · ${LISTEN_SECONDS}초 수신`);
});

ws.on("message", raw => {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  const meta = msg.MetaData || {};
  const mmsi = String(meta.MMSI || "");
  if (!byMmsi[mmsi]) return;
  const base = byMmsi[mmsi];
  const prev = store[mmsi] || {};

  if (msg.MessageType === "PositionReport") {
    const p = msg.Message.PositionReport;
    const sog = p.Sog;
    const maxSog = Math.max(prev.maxSog || 0, (typeof sog === "number" && sog < 102.3) ? sog : 0);
    store[mmsi] = Object.assign({}, prev, {
      mmsi: Number(mmsi),
      name: base.name || prev.name || meta.ShipName || String(mmsi),
      imo: base.imo || prev.imo || null,
      lat: p.Latitude, lon: p.Longitude,
      sog: sog, cog: p.Cog, heading: p.TrueHeading,
      maxSog: maxSog,                          // ← 관측된 최대 SOG 누적
      destination: prev.destination || base.destination || null,
      eta: prev.eta || base.eta || null,
      timestamp: meta.time_utc || new Date().toISOString()
    });
  } else if (msg.MessageType === "ShipStaticData") {
    const s = msg.Message.ShipStaticData;
    const cur = store[mmsi] || { mmsi: Number(mmsi), name: base.name, imo: base.imo || null };
    cur.destination = s.Destination || cur.destination || base.destination || null;
    if (s.Eta) cur.eta = `${s.Eta.Month||""}-${s.Eta.Day||""} ${String(s.Eta.Hour||0).padStart(2,"0")}:${String(s.Eta.Minute||0).padStart(2,"0")}`;
    store[mmsi] = cur;
  }
});
ws.on("error", e => console.error("WS 오류:", e.message));

setTimeout(() => {
  try { ws.close(); } catch {}
  const vessels = Object.values(store).filter(v => v.lat != null && v.lon != null);
  const out = { generatedAt: new Date().toISOString(), source: "aisstream.io", count: vessels.length, vessels };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`저장 완료 → data/fleet.json (${vessels.length}척)`);
  process.exit(0);
}, LISTEN_SECONDS * 1000);
