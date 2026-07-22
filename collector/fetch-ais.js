/**
 * FleetView AIS Collector
 * AISStream.io WebSocket에 접속해 관리 선대(mmsi.json)의 최신 위치만 받아
 * data/fleet.json 으로 저장한다. GitHub Actions가 매시간 실행.
 *
 * 필요 환경변수: AISSTREAM_API_KEY  (GitHub Secrets 에 저장)
 * 실행: node collector/fetch-ais.js
 */
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..");
const API_KEY = process.env.AISSTREAM_API_KEY;
const LISTEN_SECONDS = Number(process.env.LISTEN_SECONDS || 170); // 약 3분
const OUT = path.join(ROOT, "data", "fleet.json");

if (!API_KEY) { console.error("AISSTREAM_API_KEY 가 없습니다."); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "mmsi.json"), "utf8"));
const FLEET = cfg.vessels;                       // [{mmsi, name, destination?, eta?}]
const MMSIS = FLEET.map(v => String(v.mmsi));
const byMmsi = Object.fromEntries(FLEET.map(v => [String(v.mmsi), v]));

// 기존 데이터를 이어받아 이번에 못 받은 선박의 마지막 위치를 보존
let store = {};
try {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  (prev.vessels || []).forEach(v => { store[String(v.mmsi)] = v; });
} catch (_) {}

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

ws.on("open", () => {
  const sub = {
    APIKey: API_KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],   // 전 세계
    FiltersShipMMSI: MMSIS,                       // 관리 선박만
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  };
  ws.send(JSON.stringify(sub));
  console.log(`구독 시작 · 선박 ${MMSIS.length}척 · ${LISTEN_SECONDS}초 수신`);
});

ws.on("message", raw => {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  const meta = msg.MetaData || {};
  const mmsi = String(meta.MMSI || "");
  if (!byMmsi[mmsi]) return;

  const base = store[mmsi] || byMmsi[mmsi];

  if (msg.MessageType === "PositionReport") {
    const p = msg.Message.PositionReport;
    store[mmsi] = {
      mmsi: Number(mmsi),
      name: base.name || meta.ShipName || String(mmsi),
      lat: p.Latitude,
      lon: p.Longitude,
      sog: p.Sog,          // Speed over ground (kn)
      cog: p.Cog,          // Course over ground (deg)
      heading: p.TrueHeading,
      destination: base.destination || null,
      eta: base.eta || null,
      timestamp: meta.time_utc || new Date().toISOString()
    };
  } else if (msg.MessageType === "ShipStaticData") {
    const s = msg.Message.ShipStaticData;
    const cur = store[mmsi] || { mmsi: Number(mmsi), name: base.name };
    cur.name = base.name || cur.name;
    cur.destination = (base.destination) || s.Destination || cur.destination || null;
    if (s.Eta) cur.eta = `${s.Eta.Month || ""}-${s.Eta.Day || ""} ${String(s.Eta.Hour||0).padStart(2,"0")}:${String(s.Eta.Minute||0).padStart(2,"0")}`;
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
