# 測試串流檢查（2026-10-30）

老闆提供一個 HLS（.m3u8）測試串流，要確認訊號能不能用在網站上。依部署規範，本檔不記錄完整串流網址：來源是一台 Wowza Streaming Engine 伺服器（HTTP，port 1935，以 IP 位址存取）。

M1 的網站播放器本來就不播放 HLS（HLS 轉接器在 M1 是空殼，hls.js 也沒有安裝，屬於 M2）。這次是在本機用獨立測試頁 + hls.js 1.7.3，以 M2 會採用的方式試播，**沒有改動網站或外掛**。

## 訊號本身

| 項目 | 結果 |
|---|---|
| 格式 | HLS v3，只有 1 個版本（rendition），MPEG-TS 片段，每段 4 秒，直播中（片段序號持續增加） |
| 影像 | H.264 High@4.0，1920×1080，30 fps |
| 聲音 | E-AC-3，ffprobe 判讀為「Dolby Digital Plus + Dolby Atmos」，5.1 bed，48 kHz，448 kbps |
| 其他軌 | timed ID3 中繼資料 |
| 總位元率 | 約 6.8 Mbps（播放清單標示 6,810,488 bps；一段 4 秒約 3.25 MB） |
| CORS | `Access-Control-Allow-Origin: *`（允許網頁讀取） |
| HTTPS | 不提供：port 1935 與 443 的 HTTPS 連線都逾時 |
| 存取保護 | 沒有：知道網址的人都能觀看 |

訊號本身是真的 Dolby Atmos（DD+ JOC），與先前測過的錄音室 Atmos MP4 同一類。

## 瀏覽器試播（本機，Windows）

| 情況 | Edge 156 | Chrome 156 | Brave 156 |
|---|---|---|---|
| 瀏覽器支援 E-AC-3（MSE） | 支援 | 不支援 | 不支援 |
| 原樣（MPEG-TS）＋ hls.js | 無法播放：hls.js「Unsupported EC-3 in M2TS found」，影像也沒有出來 | 無法播放：唯一版本含 ec-3，hls.js 直接拒絕整個串流（影像也沒有） | 同 Chrome |
| 原樣（MPEG-TS）＋瀏覽器內建 HLS | 無法播放：讀到 1080p 並緩衝 12 秒後「DEMUXER_ERROR_COULD_NOT_PARSE」 | 無法播放（MEDIA_ERR 4） | 無法播放（MEDIA_ERR 4） |
| 同一批片段改封裝成 fMP4（不轉碼）＋ hls.js | **可以播放**：1080p，301 格 0 掉格，E-AC-3 聲音持續解碼，無錯誤 | 無法播放（瀏覽器不支援 ec-3） | 同 Chrome |

Edge 能解碼 E-AC-3，不代表喇叭實際輸出 Atmos 物件音訊；實際輸出要在裝置上確認（尚未確認）。Safari（iPhone／iPad／Mac）與 Apple TV 無法在這台 Windows 電腦測試，尚未確認。

## 要能在網站上播放，需要串流端調整

1. **HTTPS**：網站是 https，瀏覽器會擋下 http 的串流（混合內容）。需要以網域名稱提供 HTTPS 與有效憑證。
2. **封裝改成 fMP4（CMAF）**：MPEG-TS 裡的 E-AC-3 在 Windows 瀏覽器都無法播放；同樣的內容改成 fMP4 後 Edge 可以播放。
3. **加一個 AAC 立體聲版本**：Chrome、Brave、Firefox 等不支援 Dolby 的瀏覽器需要它，否則整個串流（包括影像）都播不出來。網站的「耳機 Binaural」模式本來就需要一個 Binaural 立體聲混音（AAC）的串流或版本。
4. **M2 另需確認**：觀看權限保護（例如有時效的網址），以及單一 6.8 Mbps、沒有較低畫質的版本，對網路較慢的觀眾與 300 人同時觀看的頻寬（約 2 Gbps）是否足夠。

以上都屬於 M2（尚待外部條件）；M1 沒有改動。
