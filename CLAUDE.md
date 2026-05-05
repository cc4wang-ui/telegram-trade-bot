# telegram-trade-bot — Claude 工作指令

> 這個 repo 是 Cross 個人交易系統的 **Telegram bot 推播服務**。獨立於 Pine 策略 repo (`cc4wang-ui/Auto-trade`)。

## 使用者

**Cross**，34 歲台灣人，mikai (17LIVE) COO，INTJ。**非工程師，永遠不會是**。

操作風格：
- 繁中 + English（依當下訊息切換）
- 先結論後解釋；表格 > 牆面文字；options > 開放題
- 講邏輯就接受推回，不要 yes-man

## 這個 repo 在做什麼

GAS Web App + Claude Code Routine + Telegram bot 推播 pipeline。

支援的 endpoints（在 `gas/macro_snapshot_handler.gs` route）：
- `?endpoint=macro_snapshot` — Macro 每日推播（Routine 觸發）
- `?endpoint=v10_signal` — Pine v10 訊號（TradingView alert webhook 觸發）
- `?endpoint=earnings` — 法說會追蹤（在 `gas/earnings_report_handler.gs`）
- `?endpoint=portfolio` / `news` / `target_price`（WF1-4，逐步上線）

## 入口

| 想做什麼 | 讀哪份 |
|---|---|
| 第一次部署 GAS + bot | `docs/deploy-runbook.md` |
| 手機快速部署 | `docs/deploy-mobile-wf2-5.md` |
| WF2-4 設計細節 | `docs/wf234-dispatch.md` |
| 改 GAS handler 邏輯 | `gas/*.gs` |
| 改 Routine 行為（earnings） | `prompts/earnings_routine_prompt.md` |
| Macro skill 邏輯 | `skills/macro-daily-analyst-report/SKILL.md` |

## 跟 cc4wang-ui/Auto-trade 的關係

| 屬於 Auto-trade | 屬於這個 repo |
|---|---|
| Pine 策略 (`pine/strategy_v10*.pine`) | GAS handler (`gas/*.gs`) |
| Macro Routine prompt (`automation/routine/macro_snapshot_prompt.md`) | Earnings Routine prompt (`prompts/earnings_routine_prompt.md`) |
| Pine alert webhook 設定文件 (`automation/gas-endpoint/pine_alert_webhook.md`) | GAS deployment runbook (`docs/deploy-runbook.md`) |
| `context/`（個人財務）| 不複製過來 — 工作邊界，bot 不需要 portfolio context |

## 不可違反

1. **不存 token / secret 在 .gs 檔裡**。所有 secret 用 GAS Script Properties。
2. **TradingView Pine alert webhook URL** 改變時，要同時更新 `pine_alert_webhook.md`（在 Auto-trade）和 GAS Script Properties。
3. **任何 endpoint 的 dedup 邏輯不可跳過** — 重複推播 = 你 Telegram 會被洗掉。

## 來源

從 `cc4wang-ui/Auto-trade` 的 `extract/telegram-bot` branch 抽出，2026-05-05 完成。原始 source PRs（已 close）：#2、#5、#6、#13。
