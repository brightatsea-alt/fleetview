# ⚓ FleetView — 선대 위치·현지시간 모니터

AIS가 끊긴 대양 항해 중에도 **추정 위치(Dead Reckoning)** 와 **선박 현지시간(Time Zone)** 을
지도에서 한눈에 보는 무료 웹 플랫폼입니다.

- **서버 0원 / 유지보수 최소** — GitHub Actions(매시간 수집) + GitHub Pages(지도 게시)
- **화면은 항상 "지금"** — 브라우저가 마지막 AIS + 속력·침로·경과시간으로 실시간 추정
- **상태 3단계** — 🟢 실측(<6h) / 🟡 추정(6–24h) / 🔴 장기추정(>24h)

> ⚠️ 화면 위치는 어디까지나 **추정치**입니다. 운영 모니터링·현지시간 판단용이며,
> PSC·사고조사 등 정확 위치가 필요한 업무에는 사용하지 마세요.

---

## 구조 (자동 당직사관 + 게시판)

```
매시간 ┌─────────────────────────┐        ┌──────────────────────┐
 cron │ GitHub Actions (수집)   │        │ GitHub Pages (게시)  │
      │ collector/fetch-ais.js  │  커밋  │ index.html           │
      │ AISStream WebSocket 3분 │ ─────▶ │  ↳ data/fleet.json    │
      │ → data/fleet.json       │        │  ↳ 브라우저가 추정계산 │
      └─────────────────────────┘        └──────────────────────┘
```

| 파일 | 역할 |
|---|---|
| `index.html` | 지도 대시보드 (Leaflet). Dead Reckoning + 현지시간 계산 전부 브라우저에서 수행 |
| `collector/fetch-ais.js` | AISStream 구독 → 관리 선박 필터 → `data/fleet.json` 저장 |
| `.github/workflows/update-ais.yml` | 매시간 cron 실행 + 자동 커밋 |
| `mmsi.json` | **관리 선대 목록(여기에 실제 60척 입력)** |
| `data/fleet.json` | 최신 위치 데이터 (Actions가 갱신, 초기값은 샘플) |

---

## 설치 (약 10분)

### 1) 리포지토리 만들기
GitHub에서 새 저장소 생성 → 이 폴더의 모든 파일 업로드(드래그&드롭 가능).

### 2) AISStream 무료 API 키
1. https://aisstream.io 접속 → 이메일로 무료 가입
2. 발급된 **API Key** 복사

### 3) API 키를 Secret 으로 저장
저장소 **Settings → Secrets and variables → Actions → New repository secret**
- Name: `AISSTREAM_API_KEY`
- Value: 발급받은 키

### 4) 관리 선대 입력
`mmsi.json` 을 열어 `vessels` 배열에 실제 선박을 채웁니다(최대 60척 권장).
```json
{ "vessels": [
  { "mmsi": 440123000, "name": "글로비스 스카이", "destination": "KRPUS Busan" },
  { "mmsi": 440123001, "name": "..." }
] }
```
`name`/`destination` 은 선택 — AIS 정적정보를 받으면 자동 갱신됩니다.

### 5) GitHub Pages 켜기
**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`** 저장.
잠시 뒤 `https://<계정>.github.io/<저장소>/` 에서 지도가 열립니다.

### 6) 첫 수집 실행
**Actions 탭 → Update AIS positions → Run workflow** (수동 1회).
이후 매시간 자동 실행됩니다.

---

## 로컬에서 미리보기
```bash
cd fleetview
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```
`data/fleet.json` 이 없거나 못 읽으면 화면 내장 샘플로 자동 표시됩니다.

---

## 계산 방식 (참고)

- **추정 위치**: `이동거리(NM) = SOG(kn) × 경과시간(h)` → 마지막 위치에서 COG 방향으로 대권항법 투영
- **불확실성 반경**: 이동거리 × 10% (점선 원). 오래될수록 커짐
- **선박 현지시간**: 항해 표준시 = `round(경도 / 15)` 시간 (경도 15° = 1시간)
- **자동 보정**: AIS 재수신 시 실측 위치로 즉시 갱신 (수집 스크립트가 store 를 덮어씀)

### 정확도 팁
- AIS Destination 문자열은 `SIN`, `SGSIN`, `SINGAPORE` 등 제각각 → `mmsi.json` 의 `destination` 에
  **UN/LOCODE(예: SGSIN, KRPUS)** 로 표준화해 두면 목적지 판독이 안정적입니다.
- 감속/증속·기상 우회·TSS 진입·표류/정박 구간은 추정 오차가 커질 수 있습니다.

---

## 한계
- GitHub 무료 cron 은 수요가 몰리면 정각보다 5~15분 지연될 수 있음 (매시간 1회는 보장).
- AISStream 무료 플랜은 위성 AIS 미포함 → 연안·기항지 근처 수신이 강하고, 대양 중앙은 공백이 큼
  (그래서 추정 로직이 필요). 대양 커버리지가 필요하면 유료 위성 AIS 소스로 `collector` 만 교체.
