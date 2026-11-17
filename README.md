# ⚡ Dhan Options Trader — Mobile App Wrapper

A high-performance, mobile-first options trading wrapper built with **React Native (Expo)** for **DhanHQ API v2**. Designed specifically for disciplined options traders on **NIFTY 50**, **BANKNIFTY**, and **BSE SENSEX**, featuring visual on-chart order placement, strict customizable psychological risk guardrails (with Auto-Exit Kill Switch), and frictionless distribution.

---

## ⬇️ 1-Click Install & Download

| Platform | Direct Link | Notes |
|---|---|---|
| 🌐 **Instant iOS & Android PWA** *(Live Now)* | [**Launch Web App →**](https://pushpak-256.github.io/dhan-options-trader/) | Open in Safari (iOS) or Chrome (Android) → **Add to Home Screen** |
| 🤖 **Android APK** | [**Download `app-release.apk` →**](https://github.com/pushpak-256/dhan-options-trader/releases/latest/download/app-release.apk) | Built automatically on release tags (`v*`) via GitHub Actions |
| 🍎 **iOS Unsigned IPA** *(AltStore / SideStore / LiveContainer)* | [**Download `DhanOptionsTrader-unsigned.ipa` →**](https://github.com/pushpak-256/dhan-options-trader/releases/latest/download/DhanOptionsTrader-unsigned.ipa) | Unsigned `.ipa` built on release tags (`v*`) for sideloading via AltStore / SideStore / LiveContainer |

---

## 🎯 Key Features

### 1. 📈 Visual On-Chart Order Placement (TradingView Lightweight Charts)
- **Direct Chart Trading**: Tap or drag horizontal lines directly on the chart:
  - 🔵 **Entry Line**: Adjust limit price or execute at market.
  - 🔴 **Stop-Loss (SL) Line**: Drag to set SL. Displays live points risk and exact cash loss in ₹ (e.g. `-20 pts (-₹1,500)`).
  - 🟢 **Target / Take-Profit (TP) Line**: Drag to set target. Displays live points reward, exact cash gain in ₹ (e.g. `+45 pts (+₹3,375)`), and real-time **Risk:Reward ratio (e.g. 1:2.2)**.
- **One-Tap Execution**: Quick Buy Call / Buy Put toggle with lot counter (`+` / `-`).

### 2. ⛓️ Multi-Index Option Chains
- Full option chains for **NIFTY 50**, **BANK NIFTY**, and **BSE SENSEX** (and FINNIFTY).
- Spot price, ATM strike auto-highlighting, ITM color-coding, Open Interest (OI), Volume, and Greeks (Delta, Theta, IV).
- Tap any Call or Put strike to load its live candlestick chart immediately.

### 3. 🛡️ Custom Compliance & Risk Guardrail Engine
Every trader (you and your friends) can configure their own personal rules in **Risk Rules**:
- **Max Daily Loss Hard-Stop**: Once your daily MTM hits your loss threshold (e.g. ₹5,000), order placement is locked for the rest of the trading session.
- **Max Risk Per Trade**: Blocks any order where $(\text{Entry} - \text{SL}) \times \text{Qty}$ exceeds your limit (e.g. ₹1,500).
- **Max Lots Per Order**: Caps lots (e.g. 2 lots) to prevent impulsive over-leveraging on 0-DTE expiry days.
- **Mandatory Stop-Loss Enforcement**: The Buy button is disabled unless a valid SL line is positioned on the chart.
- **Minimum Risk-to-Reward (R:R) Check**: Flags trades below your desired ratio (e.g. 1:1.5).
- **Revenge Trading Cooldown**: Enforces a 15-minute freeze after a stopped-out loss.
- **Opening Volatility Filter**: Blocks orders during 09:15–09:20 AM.

### 4. 🚀 Zero-Hassle GitHub APK Distribution & In-App Auto-Updater
- **Frictionless for your friends**:
  1. Your friends download the APK once from your GitHub Releases link:
     `https://github.com/<your-repo>/releases/latest/download/app-release.apk`
  2. For all future updates, the app silently checks GitHub Releases on startup. When an update is detected, a clean popup appears: *"New update available! [Update Now]"*.
  3. Tapping **Update Now** downloads the APK inside the app and triggers Android's native installer prompt. No manual visits to GitHub or developer settings required!
- **Automated Cloud Builds (GitHub Actions)**:
  - Push code or tag a version (e.g. `v1.0.0`), and GitHub's cloud runners build the signed release APK automatically.

### 5. 🔐 BYOK (Bring Your Own Key) Architecture
- Each friend inputs their own **Dhan Client ID** and **Access Token** locally in the app's Settings.
- Keys are stored solely on the device's local encrypted storage.
- Full offline Demo/Simulation mode is provided by default so friends can test charts, draggable SL/TP lines, and compliance rules before connecting real funds.

---

## 📱 Quick Start

### 1. Test on Your Phone (Expo Go & Tunneling)
Even while travelling, you can test the app live on your phone:
```bash
# Navigate to project directory
cd "C:\Users\Pushpak Bhagat\.gemini\antigravity\scratch\dhan-options-trader"

# Start Expo with tunnel enabled (accessible over mobile 4G/5G anywhere)
npx expo start --tunnel
```
1. Install **Expo Go** from Google Play Store on your Android phone.
2. Scan the terminal QR code to run the app live.

### 2. Generate Release APK via GitHub Actions
1. Initialize a git repository and push to GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: complete dhan options trading app"
   git remote add origin https://github.com/<your-username>/dhan-options-trader.git
   git branch -M main
   git push -u origin main
   ```
2. Tag a release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions (`.github/workflows/build-apk.yml`) will automatically compile `app-release.apk` and attach it to your repository's Releases page!

---

## 📂 Project Architecture

```
dhan-options-trader/
├── App.tsx                             # Main entry & bottom tab navigation
├── app.json                            # Expo & Android native permissions config
├── .github/workflows/
│   └── build-apk.yml                   # CI/CD workflow for automated APK releases
└── src/
    ├── constants/
    │   └── indices.ts                  # NIFTY, BANKNIFTY, SENSEX lot sizes & tick specs
    ├── types/
    │   ├── dhan.ts                     # DhanHQ API v2 interfaces (orders, quotes, candles)
    │   ├── compliance.ts               # Risk rules & pre-flight checks interfaces
    │   └── updater.ts                  # GitHub release & auto-updater interfaces
    ├── services/
    │   ├── storage.ts                  # AsyncStorage for BYOK keys & compliance rules
    │   ├── dhanApi.ts                  # DhanHQ v2 REST client with mock fallback
    │   ├── complianceEngine.ts         # Pre-flight risk guardrails & cooldown engine
    │   ├── githubUpdater.ts            # GitHub Release checker & native APK installer
    │   └── mockData.ts                 # Realistic market data simulator for demo mode
    ├── components/
    │   ├── Header.tsx                  # Live/Demo status, Day MTM, update pill
    │   ├── InteractiveChart.tsx        # TradingView Lightweight Chart with visual SL/TP
    │   ├── ChartOrderPanel.tsx         # Buy/Sell, lots, risk metrics, bracket order submit
    │   ├── OptionChainTable.tsx        # Strikes ladder (CE/PE) with ATM/ITM highlighting
    │   └── UpdateModal.tsx             # In-app APK download & install dialog
    └── screens/
        ├── ChartTradingScreen.tsx      # Main screen: Option chart + visual order placement
        ├── OptionChainScreen.tsx       # Strike selection across NIFTY, BANKNIFTY, SENSEX
        ├── PositionsScreen.tsx         # Open positions, day P&L, panic exit all
        ├── ComplianceSettingsScreen.tsx# User-defined risk limits & psychological rules
        └── SettingsScreen.tsx          # Dhan BYOK credentials & GitHub updater config
```
