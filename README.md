# 外付けHDD／SSDセレクター

パソコン・スマホ・テレビにつなぐI-O DATAの外付けHDD／SSDを、条件で絞り込んで比較するツール。

- 公開URL： https://ioplaza02.github.io/hdd-ssd-selector/ （パスワード：app.js の `SITE_PASSWORD`）
- データ： `data/products.json`（毎日 深夜3:00 に GitHub Actions で自動更新）
- 自動取得の読み間違いの修正： `data/overrides.json` に正しい値を書く（書き方はファイル内の説明を参照）
- USBメモリーセレクター公開後： app.js の `USB_MEMORY_SELECTOR_URL` にURLを入れるとリンクが有効になる

## ファイル
| ファイル | 役割 |
|---|---|
| index.html / style.css / app.js | 画面 |
| data/products.json | 商品データ（自動更新） |
| data/overrides.json | 手動修正（自動更新でも消えない） |
| scripts/scrape.mjs | 公式サイトからデータ取得 |
| scripts/health-check.mjs | 取得結果の異常チェック |
| .github/workflows/scrape.yml | 毎日の自動実行 |
