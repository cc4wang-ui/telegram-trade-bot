# v6 七天試運行 SOP

> 目標：驗證 daily post 品質 ≥ Cross 主對話 Claude 的 90%
> 期程：5/12（CPI 當天）~ 5/18 共 7 天
> 不及格項目 → 調 `V6_BASE_SYSTEM_PROMPT` 或 prompt template，不換工具

---

## 每日驗收（Cross 自跑，5 分鐘）

每天 09:00 看完早報、23:00 看完晚報後，填以下表格（建議直接在 Sheet 開一個 `trial_log` tab）。

| Day | Date | 08:00 morning | 22:00 evening | urgent triggers | 月累計成本 |
|---|---|---|---|---|---|
| 1 | 5/12 (CPI) | ⬜ pass / ⬜ fail | ⬜ pass / ⬜ fail | (列觸發類型 + 條數) | $ |
| 2 | 5/13 (PPI) | ⬜ ⬜ | ⬜ ⬜ | | $ |
| 3 | 5/14 | ⬜ ⬜ | ⬜ ⬜ | | $ |
| 4 | 5/15 (Powell) | ⬜ ⬜ | ⬜ ⬜ | | $ |
| 5 | 5/16 | ⬜ ⬜ | ⬜ ⬜ | | $ |
| 6 | 5/17 | ⬜ ⬜ | ⬜ ⬜ | | $ |
| 7 | 5/18 | ⬜ ⬜ | ⬜ ⬜ | | $ |

---

## 每篇 daily post 的「pass」標準（6 項）

每篇打勾 5/6 以上即 pass：

1. **燈號明確** — 文中出現 🟢🟡🟠🔴 任一
2. **12 變數掃描完整** — Tier 1-5 都至少提一次
3. **持倉數字正確** — 不出現「1810 1200 股」「NFLX 100 股」（已過時部位）
4. **日期錨定對** — 不出現「2025-」前綴的「現況」描述
5. **紀律未違反** — 沒有建議 5/15 前加倉（NFP 大 miss 例外）/ 沒有建議動 Core / 沒有建議追 1810
6. **字數 1,500-2,500** — 過短或過長皆 fail

---

## 失敗種類與對應動作

| 失敗類型 | 對應 |
|---|---|
| 燈號漏寫 | 加強 system prompt §「12 變數燈號掃描架構」段；補 few-shot example |
| 持倉錯 | 更新 `memory` sheet #3 內容 → 隔日生效（不需改 code） |
| 日期錯 | 更新 `memory` sheet #12 強化日期錨定 |
| 紀律違反 | 加進 `V6_BASE_SYSTEM_PROMPT` §「紀律守則」 |
| 字數爆 | 改 `buildMorningPrompt` / `buildEveningPrompt` 結尾「不要超過 2,500 字」加重 |
| urgent 漏報 | 看 `daily_log` 確認 monitor 有跑、`last_market_data` 有更新；調 monitorUrgentTriggers 閾值 |
| urgent 誤報 | 提高 monitor 閾值（VIX 1.10 → 1.15、KRE 0.95 → 0.92） |

---

## Tier 2 重大事件驗證點

### 5/12 (一) CPI

期望 v6 行為：
- 08:00 morning：標題提醒「今晚 20:30 CPI」、戰備狀態紅燈
- 20:30 CPI 公布：monitor 偵測到 SPX/VIX 跳動 → 觸發 urgent（opus 4.7）
- 22:00 evening：完整事件回顧 + 明日 PPI 展望

不及格的指標：
- urgent 沒觸發（VIX 沒跳但 SPX 跳了→ trigger 漏條件）
- evening 沒提 CPI 結果（events sheet 沒輸入）

### 5/13 (二) PPI / 5/15 (四) Powell

同上邏輯，特別注意：
- PPI 數據 morning 8:00 已有，evening 22:00 必須收斂
- Powell 發言常有 web_search 才補得到當日語錄

---

## 7 天總結（5/19 早上做）

```
☐ 14 篇 daily post，pass 數量：__ / 14（目標 ≥ 12）
☐ urgent 觸發數：__ 次，正確率：__ / __
☐ 月累計成本：$__（目標 < $5）
☐ 紀律違反次數：__（目標 = 0）
☐ 持倉錯誤次數：__（目標 = 0）
☐ 整體品質 vs 主對話 Claude：__%（目標 ≥ 90%）
```

不及格 → 回去調 system prompt，跑下一個 7 天；達標 → 上線正式運行，每週日做一次抽查驗收。

---

## INTJ Note

> 不及格的不是 Claude，是 prompt。
> 調 prompt 不是 hack — 是把對話累積的判讀規則文字化的過程。

每次調整都記在這份 SOP 結尾，作為 v7 改進清單。
