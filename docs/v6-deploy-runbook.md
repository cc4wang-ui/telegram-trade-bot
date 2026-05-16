# Telegram Bot v6 部署 Runbook

> v6 = v5 webhook（保留）+ GAS-side Claude API daily post（新）
> 影響面：新增 3 個 cron trigger、新增 4 個 Sheet tab、新增 5 個 Script Properties
> 既有 v5 endpoint（`macro_snapshot` / `v10_signal` / `earnings_report` …）**不動**

---

## Step 0 — 前置確認

- v5 已上線（`gas/macro_snapshot_handler.gs` 已部署為 Web App）
- 有 GAS Project 編輯權
- 有可寫的 `MACRO_SHEET_ID` Sheet

---

## Step 1 — 申請 Anthropic API Key

1. https://console.anthropic.com 開帳號
2. **Billing** → 充值 $20 USD（夠用三個月）
3. **API Keys** → Create Key（命名 `telegram-bot-v6`）
4. 複製 `sk-ant-...`（只顯示一次）

---

## Step 2 — 設定 Script Properties

Apps Script → Project Settings → Script Properties → 加：

| Property | Value | 必填 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | ✅ 必填 |
| `CLAUDE_MODEL_DEFAULT` | `claude-sonnet-4-6` | 可留空（setupV6Check 會補） |
| `CLAUDE_MODEL_URGENT` | `claude-opus-4-7` | 可留空 |
| `ANTHROPIC_API_VERSION` | `2023-06-01` | 可留空 |
| `V6_DAILY_QUOTA_USD` | `0.30` | 可留空（預設 $0.30/天） |

沿用 v5 已存在的：`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `MACRO_SHEET_ID`。

---

## Step 3 — 上傳 v6 程式碼

把以下 3 個檔案複製到 Apps Script Project：

- `gas/v6_utils.gs`
- `gas/v6_daily_post.gs`
- `gas/v6_setup.gs`

存檔。

---

## Step 4 — 跑 setupV6Check()

Apps Script 編輯器選 `setupV6Check` → ▶ Run

期望 log：

```
✅ 必要 Script Properties 已設定
  ✅ CLAUDE_MODEL_DEFAULT = claude-sonnet-4-6
  ✅ CLAUDE_MODEL_URGENT  = claude-opus-4-7
  ...
✅ 建立 sheet "memory"
✅ 建立 sheet "daily_log"
✅ 建立 sheet "events"
✅ 建立 sheet "last_market_data"
```

如缺 properties → log 會列出，回 Step 2 補齊。

---

## Step 5 — 初始化 Memory Sheet

```
選 initV6MemorySheet → ▶ Run
```

會預填 18 列（標題 + 占位）。

**Cross 必做**：開 Sheet 的 `memory` tab，**手動補完整內容**，特別：
- Memory #3（portfolio 完整數字）
- Memory #6（project knowledge 索引）
- Memory #13（4/29 市場讀數）
- Memory #16（Warsh 12 變數）

D 欄 `enabled = TRUE` 的會載入 system prompt；FALSE 會被略過。

---

## Step 6 — 手動測試

依序跑：

1. **`v6TestFetchData`** — 驗證 FRED + Yahoo 抓得到
   - 期望：console log 印出 11 個欄位，warnings ≤ 2
   - 失敗：可能 Yahoo Finance 區域封鎖 → 改 GAS Region 或補 user-agent

2. **`v6TestSystemPrompt`** — 確認 memory 動態載入
   - 期望：log 看到 18 條 memory 內嵌

3. **`v6TestMorning`** — 真實打 Claude API + Telegram
   - 期望：Telegram 收到一則「🌅 [v6 盤前]」訊息
   - 期望：`daily_log` sheet 新增一列 status=success
   - 失敗範例：API key 錯（401）/ 超 quota / Telegram 推送失敗

4. **`v6TestUrgent`** — 模擬 VIX 跳升
   - 期望：Telegram 收到「🚨 [v6 URGENT] VIX_SPIKE」

5. **`v6TestQuota`** — 印出今日已用成本
   - 期望：`{ok: true, spent: 0.04, cap: 0.30}`

任一失敗：**先 debug 再進 Step 7**，不要上 cron。

---

## Step 7 — 安裝 Cron

```
選 setupV6Triggers → ▶ Run
```

會裝 4 個 trigger：
- `syncPortfolioLiveFromSnowball` @ 07:30 Asia/Taipei（讀最新 Snowball CSV 更新 portfolio_live tradeable 列）
- `dailyPostMorning` @ 08:00 Asia/Taipei
- `dailyPostEvening` @ 22:00 Asia/Taipei
- `monitorUrgentTriggers` 每 30 分鐘

確認：Apps Script → Triggers 應該看到 4 個新項目（或跑 `listV6Triggers`）。

### Snowball CSV 自動同步

前提：
- `SNOWBALL_FOLDER_ID` Script Property 已設（v5 既有，沿用同 folder）
- Folder 內**只放最新一份 CSV**（舊的請刪掉或備份到子資料夾，sync 邏輯抓最新 LastUpdated）
- CSV header 必含 `Event` / `Date` / `Symbol` / `Price` / `Quantity` / `Currency`

行為：
- 每天 07:30 自動跑（08:00 morning post 前）
- CSV 推導淨持倉 → 減 portfolio_live locked 列 sum → 寫到 tradeable 列
- **locked 列永不動**（信託 / 太太代持，請 Cross 自行維護）
- 同 ticker 有 2+ tradeable 列 → log warning + skip
- CSV 無但 portfolio_live 有的 ticker → 不動（容許 Snowball 外的部位）

測試指令：
- `v6DryRunSnowball()` — 預覽會改什麼，不寫 sheet
- `v6TestSyncSnowball()` — 真實 sync 一次

---

## Step 8 — 切換 v5 daily post

v5 的 daily post 是 Claude Code Routine push 過來的（不是 GAS 內 cron），所以 GAS 端無需移除任何 trigger。

**Cross 動作**：到 Anthropic Routine 設定，把 `macro_snapshot` daily Routine 停掉（或保留作備援）。

v5 的 webhook endpoints（`?endpoint=v10_signal` 等）**不受影響**，繼續跑。

---

## 故障處理

| 症狀 | 排查 |
|---|---|
| Telegram 沒收到訊息 | `daily_log` 看 status 欄；status=`success` 但無訊息 → 檢查 `TELEGRAM_CHAT_ID` |
| 字數很少（< 500） | Claude API rate limit 或 quota 觸發 → 看 `daily_log` content 欄 |
| `fetchMarketData` warnings 多 | Yahoo Finance 對 GAS 區域有時封鎖 → 接受 N/A，Claude 會用 web_search 補 |
| 月成本超 $5 | 把 `V6_DAILY_QUOTA_USD` 降到 0.15、或把 `CLAUDE_MODEL_URGENT` 也改 sonnet |
| 想暫停 v6 | `unsetupV6Triggers()`（v5 不受影響） |

---

## 解除部署

```
unsetupV6Triggers()
```

只移除 3 個 v6 trigger，v5 webhook 與 sheet 保留。如要徹底刪：手動刪 `memory` / `daily_log` / `events` / `last_market_data` 四個 tab。
