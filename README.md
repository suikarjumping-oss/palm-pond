# 半畝塘

一池錦鯉。點水面撒飼料，連續幾天來餵會生小魚，小魚會慢慢長大；每天有一兩隻魚出門，隔天回來。晝夜跟著訪客當地時間，季節跟著月份換底圖，天氣隨機（每 3 小時一段）。

- 右下角放大鏡一點放大到水面、再點縮回；也可以雙指縮放（最大 3 倍）、雙指拖動，電腦用滑鼠滾輪。
- 純前端（Vite + React + TypeScript），沒有後端、不連網、不收集任何資料。
- 每位訪客的池子只存在自己瀏覽器的 localStorage（`palm-pond-v1`）；換裝置或清除網站資料就是新的池子。

## 開發

```bash
npm ci
npm run dev
```

檢查：`npx tsc -b`、`npm run lint`、`npm test`、`npm run build`。

## 改東西

- 所有數字、魚、天氣機率、小魚名字、放大倍率、網頁名稱：`src/pond/constants.ts`（網頁名稱另外改 `index.html` 的 `<title>` 和 `og:title`）。
- 玩法：`src/pond/engine.ts`；畫魚：`src/pond/draw.ts`；存檔：`src/pond/store.ts`。

## 部署

Vercel 匯入這個 repo，Framework 選 Vite，其他預設即可。正式網址：https://palm-pond.vercel.app/ 。換網域時要一起改 `index.html` 的 `og:image`、`og:url`（LINE 分享預覽圖要完整網址）。
