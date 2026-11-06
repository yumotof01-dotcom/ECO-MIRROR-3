# ECO MIRROR 3.0

> 自然のつながりを、見る。試す。確かめる。

**状態：第2工程の旧研究エンジン原本移植と実データ一致検証に成功（2026-11-06）。新アプリ第1工程のReact UIと第0工程設計基盤も保持。2021年の研究データはまだWeb画面へ接続・静的配信していません。**

ECO MIRROR 3.0 は、公開土地被覆データと再現可能な数理計算をもとに、緑地の構造的なつながりを調べ、仮想的な環境変化や植生追加の効果を比較する独立したWebアプリです。生成AIを完成アプリの実行に組み込まず、追加の有料APIを必須としません。

## 原則

- **観測 / 構造モデル / 仮定 / 未検証** を分離する。植生候補地図をハナバチの実移動・生息・受粉の証拠にしない。
- 2021年の ESA WorldCover v200 を2026年の現況と呼ばない。2020年版との差をそのまま土地変化と呼ばない。
- 440条件は条件付き数理実験であり、「未来の440通りの確率」ではない。
- 既存の ECO-MIRROR リポジトリを**残して変更しない**。旧コードは凍結した版と検証記録を照合し、必要なモジュールだけを移植する。
- アクセシビリティ、端末負荷、処理失敗の明示を画面設計の初期段階から扱う。

## 文書を読む順序

1. [製品の目的と範囲](docs/01-product-spec.md)
2. [画面体験とサイトマップ](docs/02-information-architecture.md)
3. [UIデザインシステム](docs/03-design-system.md)
4. [システム構成](docs/04-architecture.md)
5. [科学・データ契約](docs/05-science-data-contract.md)
6. [旧コードの移植計画](docs/06-migration-plan.md)
7. [品質保証・ロードマップ](docs/07-test-plan.md) / [工程表](docs/08-milestones.md)
8. [設計判断](docs/09-decisions.md) / [リスク](docs/10-risk-register.md)

## 実際に起動する新アプリ（第1工程）

Node.js **24.12以上** とnpmを使用します。旧研究のコードや有料APIキーは不要です。

```bash
npm ci
npm run dev
```

表示されたローカルURL（通常 http://127.0.0.1:5173/ ）を開きます。

- `/`：独立したホームと研究の目的
- `/explore`：Reactで動く4モード切替・6地域の選択・キーボード操作
- `/evidence`：出典と科学的な注意事項
- 未知のURL：明示的な404ページ

**Web画面の研究計算は未接続です。** アプリ側の地図は装飾的な概念図で、正式な土地被覆・PC・生物の移動を表示しません。
第2工程の**研究CLIは移植済みで、旧版と全件一致を検証済み**です。公開UIへの接続には、監査済みデータの分割配信・検証・端末性能確認が必要です。
研究CLIが動くことは、ブラウザで実データを操作できることや、生物学的な妥当性の証明を意味しません。

```bash
npm run design:check
npm test
npm run build
npm run preview
```

`npm test`は設計5件に加え、React UI5件と数理モデル22件のVitestを実行します（2026-11-06のCIで合計32件PASS）。
`npm run build`はTypeScriptの検査とViteの静的バンドル出力です。
GitHubリポジトリのPublic化とは別に、Cloudflare Pagesで**第1工程のUIは公開済み**です。2021年の研究計算データの画面配信はまだ行っていません。

`FILE_MANIFEST_SHA256.json`は**第0工程の最初の設計ファイルアップロード時点の記録**で、現在のブランチすべてのファイルを列挙するライブマニフェストではありません。

## Webサイトの公開：Cloudflare Pages稼働中（UI第1工程・計算は未接続）

公開対象は新アプリ第1工程のReact UI。**実際の生態学的データ・計算はまだ未接続**。

GitHub Pagesはソース設定保存後も実行前にジョブが失敗し、原因の詳細を取得できないため、Cloudflare Pagesへ切り替えました。GitHub Pagesのデプロイワークフローは自動実行を停止して保管しています。

- Cloudflare公式Git連携を使い、**ECO-MIRROR-3** リポジトリを選択する。
- **Production branch：`feat/phase1-react-app-shell-2026-11`**（重要：今はmainではない）。
- **Build command：`npm run build` / Build output：`dist`**。
- **Node.js：`24.22.1`**（`.node-version`ファイルで固定）。
- `GITHUB_PAGES_DEPLOY`環境変数は設定しない。
- **https://eco-mirror-3.pages.dev/**：2026-11-06にHTTP 200と本番JavaScript・CSSの正常な配信を外部検証済み。過去の白画面はCloudflareのビルド設定が未設定だったことが原因で、現在は解消。Web画面には第2工程の2021年研究結果をまだ表示しません。

公開先の構成と当時の障害原因は[Cloudflare Pages公開手順](docs/16-cloudflare-pages-release.md)に記録。旧版の研究コードは変更していません。

## 第2工程｜独立研究CLIの移植と検証

- [元ソース固定コミットと16ファイルのバイト照合](provenance/legacy-import-manifest.json)
- [移植構造と科学的な適用範囲](docs/17-phase2-landscape-engine.md)
- [実行済みの全結果：3,080条件＋42,240比較の全バイト一致](docs/18-phase2-validation-results.md)
- GitHub Actionsの[研究移植監査・6都市＋大型地図](https://github.com/yumotof01-dotcom/ECO-MIRROR-3/actions/runs/42188754928)

この研究CLIは`src/features/landscape`および`scripts/landscape`にあり、Web画面とは独立しています。元CSV 3,882件は移植していません。

## 見られるもの

- `design/prototype.html` — **デザイン確認専用**の静的ワイヤーフレーム。実データ・シミュレーションは接続していません。
- `design/tokens.json` — 色・余白などの初期デザイントークン。
- `contracts/` — 新アプリ用の**提案段階**のJSON Schema。旧システムの実装済み形式と同じではありません。
- `tests/` — 設計配布物の整合性チェック。科学的な計算テストとは別です。

## 開いて確認

外部パッケージのインストールなしで、ブラウザ表示と初期設計のテストができます。

```bash
npm test
python -m http.server 8000
```

続いて `http://localhost:8000/design/prototype.html` を開いてください。Pythonがなければ `design/prototype.html` をブラウザで直接開いても構いません。

**重要：静的デザイン用プロトタイプを開けることは、実データを扱う研究機能が公開ブラウザで動作することの証明ではありません。**

## リポジトリの作成

新しい独立リポジトリ [yumotof01-dotcom/ECO-MIRROR-3](https://github.com/yumotof01-dotcom/ECO-MIRROR-3) はコンテスト向けにPublicで運用中。第0工程の設計、第1工程の公開UI、第2工程の独立研究CLIの移植と一致検証まで完了。**現段階で公開Webアプリに研究結果を接続したという意味ではありません。** 初期構築履歴は [GitHubセットアップ](docs/11-github-setup.md)。

## 出典

- 元の研究コードと検証：[旧 ECO-MIRROR、Draft PR #20](https://github.com/yumotof01-dotcom/ECO-MIRROR/pull/20)
- 土地被覆：[ESA WorldCover 2021 v200](https://esa-worldcover.org/en/data-access)、CC BY 4.0。

現段階で新アプリに採用するソフトウェアライセンスは未決定です。第三者データのライセンスは別途尊重します。
