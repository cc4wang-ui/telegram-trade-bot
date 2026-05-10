# telegram-trade-bot — Claude Project Handover

> 這份 doc 是給 Anthropic Claude Project (claude.ai/projects) 的 handover prompt。整份貼進 Project 的 Custom instructions 或 Project knowledge，未來 Cross 在那邊開 chat 即可繼續 telegram-trade-bot 的維運工作。
>
> Living doc — 每次 session 有新 gotcha / 新步驟，PR 更新這份；Cross merge 後 GitHub Pages 自動 mirror HTML。

## Central Question

> 在「我不寫 code、只用手機」的前提下，怎麼讓 Macro / v10 Pine / earnings 三條訊號管線 24/7 推到我 Telegram 不斷線？

> ⚠️ Strawman — Cross review 後可直接覆蓋這節，commit 進 PR。

## Project Objective

> 維護一個低維護成本的個人交易訊號推播系統（Anthropic Routine + GAS Web App + Telegram bot），三條管線端到端自動化，每一段都有手機可恢復的應急 SOP，斷線 24h 內能自我發現。

> ⚠️ Strawman — 同上，可改。

## 使用者

**Cross**，34 歲台灣人，mikai (17LIVE) COO，INTJ。**非工程師，永遠不會是**。

操作風格：
- 繁中 + English（依當下訊息切換）
- 先結論後解釋；表格 > 牆面文字；options > 開放題
- 講邏輯就接受推回，不要 yes-man

## Service 架構

```
TradingView Pine alert ──┐
                          ▶ GAS Web App (多 endpoint) ──▶ Telegram
Anthropic Routine ───────┘
```

| 屬於 cc4wang-ui/Auto-trade | 屬於 cc4wang-ui/telegram-trade-bot（這個 repo）|
|---|---|
| Pine 策略 (`pine/strategy_v10*.pine`) | GAS handler (`gas/*.gs`) |
| Macro Routine prompt (`automation/routine/macro_snapshot_prompt.md`) | Earnings Routine prompt (`prompts/earnings_routine_prompt.md`) |
| Pine alert webhook 設定文件 (`automation/gas-endpoint/pine_alert_webhook.md`) | GAS deployment runbook (`docs/deploy-runbook.md`) |
| `context/`（個人財務）| 不複製過來 — 工作邊界，bot 不需要 portfolio context |

GAS endpoints（在 `gas/macro_snapshot_handler.gs` route）：
- `?endpoint=macro_snapshot` — Macro 每日推播（Routine `daily-macro-snapshot` 觸發）
- `?endpoint=v10_signal` — Pine v10 訊號（TradingView alert webhook 觸發）
- `?endpoint=v10_state` / `read_v10_state` — D2/D3 狀態快照
- `?endpoint=earnings_report` — 法說會追蹤（Routine `earnings-watchlist` 觸發）
- `?endpoint=read_watchlist` — Routine 動態讀清單

## Knowledge Base 引用

| 來源 | 接法 | 用途 |
|---|---|---|
| Obsidian vault | Cross 把 vault export 成 PDF/HTML 放 Google Drive 資料夾 → Claude Project 透過 Google Drive connector 連那個資料夾 | 個人 KB（過去決策、context、references）|
| 本 repo (telegram-trade-bot) | 重要 .md 整檔上傳到 Project knowledge 或 Project 連 GitHub | CLAUDE.md / docs/deploy-runbook.md / docs/emergency-mobile-recovery.md / docs/wf234-dispatch.md |
| 上游 repo Auto-trade | 同 KB（Macro prompt 必上傳）| Pine 策略 + `automation/routine/macro_snapshot_prompt.md` |

> ⚠️ **Cross 待填**：你的 Obsidian vault GDrive 資料夾路徑：`______`

## 已完成步驟（截至 2026-05-08）

1. 從 Auto-trade `extract/telegram-bot` branch 拆出 → cc4wang-ui/telegram-trade-bot **PR #2 merged**
2. 修 `gas/macro_snapshot_handler.gs:34` doPost fallthrough ReferenceError + 寫 `docs/emergency-mobile-recovery.md` → **PR #3 merged**
3. GAS `testMacroSnapshot` 推 Telegram 成功（5/7）
4. Routine `daily-macro-snapshot` 改連 cc4wang-ui/Auto-trade（macro prompt 在那）
5. Routine `earnings-watchlist` 補 `GAS_WEBHOOK_URL_BASE` secret（仍在 debug，下節）
6. 5/8 08:10 收到第一則自動推播（fallback 路徑，GAS 直連仍 Page Not Found）

## 預計接下來的步驟

| 優先 | 步驟 | 為什麼 |
|---|---|---|
| 🔴 高 | debug `GAS_WEBHOOK_URL_BASE` 沒生效（5/8 13:06 UTC earnings routine 仍報「未設定」）| earnings 條沒通；audit 路徑見下節 gotcha #9, #10 |
| 🔴 高 | 解 GAS Web App「Page Not Found」（比對 connector URL vs deployment URL，或 access 設定 = Anyone vs Anyone with Google account）| macro 條的 GAS 直連沒通，目前靠 fallback 撐 |
| 🟡 中 | earnings routine Run now 驗收（前兩件解後）| 確認 earnings 條 end-to-end 通 |
| 🟡 中 | macro 訊息內容調整（4 個切點：估算警告太多 / v10 D2/D3 自動拉 / 簡化分析摘要 / 合併行動+風險）| 訊息太冗 |
| 🟡 中 | 觀察 5/9-5/10 自動排程能不能跑、無 fallback 標記 | 端到端驗收 |
| 🟢 低 | 設 `pingHealth` GAS time-driven trigger 每天推一句「🟢 alive」 | Routine 又掛時 24h 內知道，不會再三天斷推 |
| 🟢 低 | Auto-trade 收尾：close 對應的 PRs（#2/#5/#6/#13）、刪 stale branches、把 stale `automation/gas-endpoint/macro_snapshot_handler.gs` 換成 README pointer | 清乾淨 |

## 踩過的坑 / Gotchas

1. **GAS doPost line 34 fallthrough**：原始 code 註解假設使用者已有「v5 bot 1003 行」接在底下；否則 unknown endpoint 會 ReferenceError 整個炸 doPost。已 fix（PR #3）。
2. **Anthropic Routine auto-disable**：連續失敗會自動停（這次三天斷推主因）。修完要記得 re-enable + Run now 驗。
3. **GAS deployment URL vs version**：改 code 後 `testMacroSnapshot` 在 editor 跑 OK ≠ Web App URL 對外可達。要 **Manage deployments → ✏️ → New version**（不是最上面藍色 New deployment，那會換 URL → 全 Routine 設定要重設）。
4. **Token 同步雙寫**：rotate Telegram token 時 GAS Script Properties + Anthropic `auto-trade-env` connector 兩邊都要改，否則 Routine fallback 會 401。
5. **Macro routine 連在 Auto-trade、earnings 連在 telegram-trade-bot**：拆 repo 後容易設錯。Macro prompt 在 `automation/routine/macro_snapshot_prompt.md`（Auto-trade），earnings prompt 在 `prompts/earnings_routine_prompt.md`（這裡）。
6. **`GAS_WEBHOOK_URL` vs `GAS_WEBHOOK_URL_BASE` 兩個 secret**：macro 用含 `?endpoint=macro_snapshot` 的，earnings 用不含的（routine 自拼多 endpoint）。
7. **瀏覽器 GET 不能驗 doPost**：GAS 只實作 doPost，瀏覽器送 GET 一定回 "Script function not found: doGet"，**跟 deployment 是否健在無關**。要驗用 Routine Run now 或 `testMacroSnapshot` 在 Apps Script editor。
8. **Claude Project Google Drive connector 不直接吃 .md**：要把 Obsidian vault export 成 PDF/HTML 上傳，不是直接同步整個 .md vault。
9. **Connector secret 改了 routine 不一定立即 reload**：5/8 加 `GAS_WEBHOOK_URL_BASE` 後 earnings routine 13:06 UTC 仍報「未設定」。修法：disable routine → 等 30s → enable 強制 reload；或 audit secret 名 / connector 是否真的綁到該 routine。
10. **Routine prompt 期望的變數名 vs Connector 實際 key 易 drift**：每次新增 secret 後對照 prompt（`prompts/earnings_routine_prompt.md` / Auto-trade 的 `macro_snapshot_prompt.md`）裡 `${VAR_NAME}` 引用名要完全一致（大小寫 + 底線）。

## 不可違反

1. **不存 token / secret 在 .gs 檔裡**。所有 secret 用 GAS Script Properties。
2. **TradingView Pine alert webhook URL** 改變時，要同時更新 `pine_alert_webhook.md`（在 Auto-trade）和 GAS Script Properties。
3. **任何 endpoint 的 dedup 邏輯不可跳過** — 重複推播 = Telegram 會被洗掉。

## 故障排查（30 秒分流）

| # | 問題 | 怎麼驗 | 結論 |
|---|---|---|---|
| 1 | Bot 本身活著嗎？ | 手機開 `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=ping` | 收到 ping → bot OK，跳 #2；401 → token revoke；404 → URL 格式錯或 bot 被刪 |
| 2 | GAS 有人在打嗎？ | 手機桌面模式 [script.google.com](https://script.google.com) → 你的專案 → ☰ → Executions | 完全沒紀錄 → Routine 沒打進來，跳 #3；有紀錄但 Failed → 看 stack trace |
| 3 | Routine 還活著嗎？ | [claude.ai/code/routines](https://claude.ai/code/routines) | 「Auto disabled」→ 連續失敗被砍，照 `docs/emergency-mobile-recovery.md` A1-A4 修 |

完整修法見 `docs/emergency-mobile-recovery.md`。

## Deliverable（每次 Claude Project session 應產出）

| 工作類型 | Deliverable |
|---|---|
| Code 改動 | PR 到 cc4wang-ui/telegram-trade-bot（draft）|
| Macro prompt 改動 | PR 到 cc4wang-ui/Auto-trade（draft，**不是這個 repo**）|
| 故障排查 | 短報告含「症狀 / 根因 / 修法 / 驗證結果」四段 |
| 推播內容調整 | 先 PR md → merge 後 Cross 手機照 SOP 同步 GAS（用 Manage deployments edit 保住 URL）|
| 新 endpoint 設計 | 在這份 doc 補進「預計接下來的步驟」+ 寫設計到 `docs/wf234-dispatch.md` |
| 新 gotcha 發現 | 直接更新本 doc 的「Gotchas」節 |

## Operation 風格約束

每次回應 Cross：
- **短**。表格 > 長文。
- **表格優先選項**；不要開放題。能用 A/B/C 給 options 就用。
- **結論先講；解釋後給**。
- **不要 yes-man**。有理由就推回，但不要為了反對而反對。
- **手機優先**。操作步驟預設 Cross 沒電腦，要能在手機完成。電腦才能做的步驟要明標「⚠️ 要桌面」。
- **每個 secret rotate / 架構變動 → update 這份 doc 的對應段**。

## 相關 repo

- 這個 repo：[cc4wang-ui/telegram-trade-bot](https://github.com/cc4wang-ui/telegram-trade-bot)
- 上游 Pine 策略 + Macro Routine prompt：[cc4wang-ui/Auto-trade](https://github.com/cc4wang-ui/Auto-trade)
