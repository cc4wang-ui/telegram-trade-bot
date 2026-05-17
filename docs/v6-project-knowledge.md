# Telegram Bot v6 — Project Knowledge

> 從 2026-05-11 ~ 2026-05-17 之間建置完成。本文件為 canonical reference，
> archive 對話串後仍能讓新 Claude session / 未來 Cross 自己快速接手。

---

## 1. 系統做什麼

v6 = v5 既有 GAS Telegram bot **+** Claude API 判讀層 **+** Snowball 持倉自動同步。

每天自動：
- **07:30** Asia/Taipei — `syncPortfolioLiveFromSnowball()` 讀 Drive 內最新 Snowball Holdings snapshot CSV，更新 `portfolio_live` sheet 的 tradeable 列
- **08:00** — `dailyPostMorning()` 跑 Claude API（sonnet 4.6 + web_search），推 Telegram 盤前報告
- **22:00** — `dailyPostEvening()` 同上，盤後判讀
- **每 30 min** — `monitorUrgentTriggers()` 監控 VIX +10% / WTI >105 / 10Y >4.5 / KRE −5% / TXF1 ±1.5%，觸發 → `dailyPostUrgent()` 用 opus 4.7 + web_search 推緊急訊號

v5 既有的 webhook (`?endpoint=v10_signal` / `earnings_report` 等) **不動**。
v5 的 macro_snapshot Routine（Anthropic 雲端那個）Cross 自行**停掉**避免 dup 推播。

---

## 2. 架構決策（為什麼這樣做）

| 議題 | 決策 | 為什麼 |
|---|---|---|
| 數據抓取 | GAS-side 直接打 FRED CSV + Yahoo chart API | 不依賴外部 Routine；無 API key |
| 模型選擇 | morning/evening sonnet 4.6；urgent opus 4.7 | sonnet 4.6 判讀夠用；urgent 需 opus + web_search |
| web_search | morning/evening/urgent 全啟用，max_uses=2 | 補實時數據；2 次能覆蓋核心查詢且控本 |
| 成本上限 | `V6_DAILY_QUOTA_USD = 0.50`/天 | 月 ~$15 USD；超過退化發 warning |
| portfolio 來源 | Snowball Holdings snapshot CSV + 信託 hardcode | snapshot = source of truth；信託不在 Snowball 看到的格式 |
| 信託 / partial lock | 用 V6_LOCKED_POSITIONS hardcode 在 v6_setup.gs | Cross 拒絕手動 sheet 編輯；信託變動罕見 |
| 不在 Snowball 的 ticker | 用 V6_MANUAL_TRADEABLE hardcode（00632R 15000）| 元大反一不在 Snowball |
| sync 算法 | locked-subtraction：tradeable = snapshot_total − locked_sum | 支援 partial lock（QQQ 38 = 10 自由 + 28 信託）|

---

## 3. 檔案結構

### Repo 內

| 路徑 | 行 | 角色 |
|---|---|---|
| `gas/v6_utils.gs` | ~570 | fetchMarketData (FRED+Yahoo) / cost / quota / Telegram split / parseSnowballSnapshot / syncPortfolioLiveFromSnowball |
| `gas/v6_daily_post.gs` | ~580 | V6_BASE_SYSTEM_PROMPT / 3 prompt 模板 / callClaudeAPI / 3 主函式 / monitorUrgentTriggers / v6Test* |
| `gas/v6_setup.gs` | ~340 | V6_LOCKED_POSITIONS / V6_MANUAL_TRADEABLE / setupV6Check / initV6PortfolioLiveBase / resetV6PortfolioLiveBase / setupV6Triggers |
| `gas/macro_snapshot_handler.gs` | 2326 | v5 原版（含 normalizeTicker / currencyToMarket / syncFromSnowball / NEWS_CATEGORY_ICON 等）— **不動** |
| `gas/earnings_report_handler.gs` | — | v5 原版 — **不動** |
| `docs/v6-deploy-runbook.md` | — | 部署 SOP |
| `docs/v6-7day-trial-sop.md` | — | 試運行驗收 |
| `docs/v6-memory-template.csv` | — | 18 條 memory 預填 |

### Cross 的 Apps Script Project

| 檔名 | 來源 |
|---|---|
| `v10.2 main.gs` | v5 原始 bot，含 macro_snapshot 邏輯（**不動**）|
| `v6_utils.gs` | repo gas/v6_utils.gs |
| `v6_daily_post.gs` | repo gas/v6_daily_post.gs |
| `v6_setup.gs` | repo gas/v6_setup.gs |

⚠️ **Cross 的 macro_snapshot 內容在 `v10.2 main.gs` 裡**，不在獨立檔。曾經誤建立過 `macro snapshot.gs` 重複檔造成 NEWS_CATEGORY_ICON 重複宣告，已刪。**任何時候不要叫 Cross 重貼 v10.2 main.gs**。

---

## 4. Cross 持倉硬編碼（v6_setup.gs）

```javascript
const V6_LOCKED_POSITIONS = [
  { ticker: '2330',   market: 'TW', shares: 920,   note: '信託 / 台積電' },
  { ticker: '2382',   market: 'TW', shares: 2188,  note: '信託 / 廣達' },
  { ticker: '00956',  market: 'TW', shares: 4308,  note: '信託 / CTBC TOPIX' },
  { ticker: '006208', market: 'TW', shares: 3545,  note: '信託 / 富邦台 50' },
  { ticker: 'QQQ',    market: 'US', shares: 28,    note: '信託' }
];
const V6_MANUAL_TRADEABLE = [
  { ticker: '00632R', market: 'TW', shares: 15000, note: '元大反一對沖 / 不在 Snowball' }
];
```

Cross 確認 tradeable 部位（Snowball 看到的）：
- VTI 10 / VOO 10 / QQQ 10（38−28）/ NVDA 15 / NFLX 50 / IXC 60 / 9660 16800
- 加上 00632R 15000（手動）

最終 `portfolio_live` 13 列：6 base + 7 tradeable（從 snapshot 自動算）。

---

## 5. Snowball CSV 格式

Cross 上傳路徑：`SNOWBALL_FOLDER_ID` Drive folder，1 個檔，**Holdings snapshot 格式**（不是 Transactions）。

必要 header（CSV 第一列）：
```
"Holding","Holdings' name","Note","Shares","Currency","Cost basis","Current value",...
```

關鍵 column：
- `Holding` → ticker（有 BOM 防呆）
- `Shares` → 股數
- `Currency` → USD/HKD/TWD → market US/HK/TW
- `Cost per share` → optional avg_cost

11 列範例（Cross 5/16 snapshot）：
VTI / VOO / QQQ / NVDA / NFLX / IXC / 9660 / 2382 / 2330 / 00956 / 006208

Snowball **不顯示**：00632R（元大反一對沖在 Snowball 外）。

---

## 6. Script Properties（GAS Project Settings）

| Key | 用途 | 必填 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API | ✅ |
| `TELEGRAM_BOT_TOKEN` | v5 既有 | ✅ |
| `TELEGRAM_CHAT_ID` | v5 既有 | ✅ |
| `MACRO_SHEET_ID` | v5 既有 | ✅ |
| `SNOWBALL_FOLDER_ID` | v5 既有 | ✅ |
| `ROUTINE_TOKEN` | v5 既有 | ✅ |
| `PINE_ALERT_SECRET` | v5 既有 | ✅ |
| `CLAUDE_MODEL_DEFAULT` | 預設 `claude-sonnet-4-6` | 自動補 |
| `CLAUDE_MODEL_URGENT` | 預設 `claude-opus-4-7` | 自動補 |
| `ANTHROPIC_API_VERSION` | 預設 `2023-06-01` | 自動補 |
| `V6_DAILY_QUOTA_USD` | 預設 `0.50` | 自動補 |
| `V6_TRIGGER_<TYPE>` | urgent dedup 戳記（系統寫入） | 自動 |

---

## 7. Cron Triggers（4 個）

```
syncPortfolioLiveFromSnowball  @ 07:30 Asia/Taipei  daily
dailyPostMorning               @ 08:00 Asia/Taipei  daily
dailyPostEvening               @ 22:00 Asia/Taipei  daily
monitorUrgentTriggers          every 30 min
```

裝/拆指令：`setupV6Triggers()` / `unsetupV6Triggers()` / `listV6Triggers()`

---

## 8. 常見操作 SOP

### 8.1 Snowball 持倉變動（買賣）
- Cross 從 Snowball Holdings panel re-export CSV
- 上傳到 Drive folder（覆蓋舊檔 / 或讓新檔 lastUpdated 比較新）
- **不用做別的**；07:30 cron 自動同步

### 8.2 信託（locked）部位變動（罕見）
- Cross 告訴 Claude「信託 XX 變 YY」
- Claude 改 `V6_LOCKED_POSITIONS` array → push PR
- Cross 重貼 v6_setup.gs → 跑 `resetV6PortfolioLiveBase()` 一次
- 自動清空 + 重寫 base + sync tradeable

### 8.3 新增不在 Snowball 的 ticker（如新券商）
- Claude 加進 `V6_MANUAL_TRADEABLE` array → push
- 同上流程

### 8.4 月成本超預期
- Cross 看 `daily_log` sheet 找出哪幾天高
- 選項：降 `V6_DAILY_QUOTA_USD` Script Property、降 `max_uses` 在 v6_daily_post.gs（目前 2）、改 urgent 也用 sonnet
- 月 ~$15 是預期（quota $0.50 × 30 + urgent buffer）

### 8.5 暫停 v6（保留 v5）
- 跑 `unsetupV6Triggers()`
- v5 webhook / Pine alert / earnings 不受影響

### 8.6 daily post 品質不及格
- 對照 `docs/v6-7day-trial-sop.md` 6 項驗收
- 調整 `V6_BASE_SYSTEM_PROMPT`（在 v6_daily_post.gs 前段）
- 或更新 memory sheet（特別 Memory #3 / #6 / #13 / #16）

---

## 9. 重要 Gotchas（踩過坑）

### G1. Snowball CSV BOM
UTF-8 BOM (U+FEFF) 在檔首 → parseCsv 把 cell 0 當未 quoted → header 變 `"Holding"`（含字面引號）。
**修法**：`parseSnowballSnapshot()` 在 `parseCsv` 之前先剝 raw text 開頭的 BOM。

### G2. Snowball 不分帳戶（partial lock）
Snowball 把所有帳戶持倉**加總**成單行（如 QQQ 38 = 自由 10 + 信託 28）。
無法用 CSV 區分 → locked rules hardcode 在 GAS code。

### G3. 大檔重貼風險（v5 主檔 94KB）
Cross 重貼 v5 macro_snapshot_handler.gs 時 GAS 創新檔 → NEWS_CATEGORY_ICON 重複宣告 → SyntaxError。
**規則**：**永遠不叫 Cross 重貼 v10.2 main.gs**。v5 改動全部放棄，只動 v6 三檔。

### G4. CSV 缺早期 BUY（已棄用）
舊 transaction 格式 CSV 因缺早期 BUY → netQty 負 → 誤殺 tradeable。
**已棄用**：改用 snapshot 格式從根本解決，問題消失。

### G5. 文件名稱不一致
TW ticker 有 `00956` (with leading zeros) vs `956`（normalized）。
**修法**：`normalizeTicker()` 統一比對；append 用 CSV 原始格式。

### G6. zero-share tradeable noise
全 locked 的 ticker（如 2330 920 完全 locked）snapshot total = locked sum → target=0。
**修法**：target=0 + 無 tradeable 列 → skip，不寫 0 股 noise 列。

---

## 10. 部署狀態（2026-05-17）

- Branch: `claude/deploy-telegram-bot-v6-Z5Qml`
- PR: cc4wang-ui/telegram-trade-bot#5（draft）
- Latest commit: 45711a2 "v6 setup: hardcode locked + manual positions"
- 4 cron triggers 安裝完成
- daily_log 已記錄過 successful morning + urgent 測試
- 月成本估算 ~$15 USD

待 Cross 完成（archive 後重啟需要的）：
- 跑 setupV6Check（會自動 init portfolio_live 6 base 列）
- 跑 v6TestSyncSnowball（補 7 tradeable 列）
- 確認 portfolio_live 13 列正確
- 5/12-5/18 7 天試運行驗收（依 docs/v6-7day-trial-sop.md）

---

## 11. 未來方向（v7 candidates）

- **Prompt caching**：system prompt 大、每次重餵 → 可省 ~50% input cost
- **Memory 自動 sync**：目前 Cross 主對話 update memory 後要手動同步到 Sheet → Anthropic 之後若提供 memory API 可自動化
- **Lock rules 從 Script Property 讀**：目前 hardcode，要重貼檔；改 Property JSON 後 Cross 只需編輯 Property
- **Cost monitoring alert**：月成本超 $10 自動推 Telegram 警告
- **Quality auto-retry**：validatePost 不及格時自動 retry 一次
- **Earnings 整合**：把 v5 earnings_watchlist 結合進 daily post（目前完全獨立）

---

## 12. 跟 cc4wang-ui/Auto-trade repo 的邊界

| 屬於 Auto-trade | 屬於這個 repo |
|---|---|
| Pine 策略 (pine/strategy_v10*.pine) | v6 GAS handler (gas/v6_*.gs) |
| Macro Routine prompt | Daily post prompt (在 v6_daily_post.gs 內 V6_BASE_SYSTEM_PROMPT) |
| Project knowledge: cpi-sop / hedge-decision-tree / playbook 等 | Memory sheet（從 PK 摘要載入） |
| `context/`（個人財務細節）| 不複製過來 |
