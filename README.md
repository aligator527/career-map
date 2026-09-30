# キャリアマップ / Career Map

公的統計をもとに、「自分と似た条件の人が社会の中でどの位置にいるか」を可視化するプロトタイプです。
国・地域・職業・年齢・性別・学歴・年収を入力すると、似た条件の人の年収分布と自分の位置、条件（年齢・学歴・地域・国）を変えた集団との比較、地域別の地図を表示します。金額は額面・手取り（税と社会保険料の概算）・物価調整後の手取りから選べます。「A 歳で年収 X 以上」「A 歳で管理職」といった目標について、似た条件の人の到達率、年齢別の推移、条件を1つ変えた場合、到達している人の内訳も表示します。

- 対象: 日本（賃金構造基本統計調査 2025）、米国（ACS PUMS 2024）、英国（ASHE 2025）、カナダ（2021 年国勢調査 PUMF）、ドイツ・フランス・イタリア（Eurostat SES 2022）
- 計算はすべてブラウザ内で行い、入力はサーバーに送りません
- 設計: [docs/DESIGN.md](docs/DESIGN.md)

## 構成

```
pipeline/   公開統計をダウンロードし、配信用 JSON を作る（Python, uv）
web/        静的サイト（Vite + React + TypeScript）
  public/data/   パイプラインの出力（コミット対象）
data/raw/   ダウンロードした生データ（.gitignore 対象）
```

## 開発

```bash
cd web
npm install
npm run dev
```

テストとビルド:

```bash
cd web
npm test
npm run build

cd ../pipeline
uv run pytest
```

## データの再生成

API キーは不要です。米国の個票は約 600MB（展開後 約 2.4GB）、カナダの個票は約 180MB（展開後 約 600MB）をダウンロードします。

```bash
cd pipeline
uv run python -m career_pipeline          # すべて
uv run python -m career_pipeline jp fx    # 一部だけ（fx, prices, tax, jp, us, uk, ca, eu, occupations）
```

## 公開

- **GitHub Pages**: リポジトリの Settings → Pages → Source を「GitHub Actions」にすると、`main` への push で `.github/workflows/deploy.yml` がビルド・公開します。
- **Vercel**: Root Directory を `web` に設定するだけで動きます（ビルドコマンド `npm run build`、出力 `dist`）。

`vite.config.ts` で `base: './'` にしているので、どちらのパスでもそのまま動きます。

## 出典

- 厚生労働省「令和7年賃金構造基本統計調査」（e-Stat）
- U.S. Census Bureau, American Community Survey 2024 1-Year PUMS
- World Bank, World Development Indicators（為替レート・購買力平価）
- 総務省「小売物価統計調査（構造編）」消費者物価地域差指数
- U.S. Bureau of Economic Analysis, Regional Price Parities
- 州所得税: Tax Foundation ほか（`pipeline/career_pipeline/labels/us_state_tax_2025.json` の `_source`）
- ONS, Annual Survey of Hours and Earnings（英国）
- Statistics Canada, 2021 Census Public Use Microdata File（Statistics Canada Open Licence）
- Eurostat, Structure of Earnings Survey 2022 / 2018
- カナダの税: Canada Revenue Agency（T4127）ほか（`pipeline/career_pipeline/labels/ca_tax_2025.json` の `_source`）
