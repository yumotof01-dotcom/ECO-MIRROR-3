# ECO MIRROR 3.0

> 自然のつながりを、見る。試す。確かめる。

**状態：新アプリ第1工程のReact/TypeScript/Viteアプリ骨格（2026-11-06）。第0工程の設計基盤v0.1も維持。実装済みの研究エンジンや実データは、この新しいフォルダーにはまだ移植していません。**

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

**第1工程の計算は未接続です。** アプリ側の地図は装飾的な概念図で、正式な土地被覆・PC・生物の移動を表示しません。
第2工程で固定済みの旧研究エンジンを移植し、数値照合してから研究機能を有効化します。
第1工程ができたことは研究エンジンの移植や公開Webアプリの完成ではありません。

```bash
npm run design:check
npm test
npm run build
npm run preview
```

`npm test`は従来の設計テストに加えて、Reactの画面切替・地域の未接続表示・キーボード操作・根拠表示を確認します。
`npm run build`はTypeScriptの検査とViteの静的バンドル出力です。
GitHub上でのPublic化はWebアプリのホスティングとは別で、本番公開はまだ行っていません。

`FILE_MANIFEST_SHA256.json`は**第0工程の最初の設計ファイルアップロード時点の記録**で、現在のブランチすべてのファイルを列挙するライブマニフェストではありません。

## GitHub Pagesの公開（設定待ち）

第1工程のWebサイト公開用に `.github/workflows/deploy-pages.yml` を追加しました。

**現時点では公開完了ではありません。** GitHub Pagesの設定が未有効であり、自動デプロイの最初の試行は「Get Pages site failed」で停止しました。

- [Pagesの設定](https://github.com/yumotof01-dotcom/ECO-MIRROR-3/settings/pages) → **Build and deployment → Source → GitHub Actions** を選ぶ。
- 設定後にActionsの **Deploy ECO MIRROR 3.0 to GitHub Pages** の失敗した実行を **Re-run all jobs** で再実行するか、このチャットで設定完了を知らせる。
- デプロイ成功後のサイトURL：**https://yumotof01-dotcom.github.io/ECO-MIRROR-3/**
- 直接リンク：`#/explore`（探索）・`#/evidence`（根拠）。GitHub PagesではHashRouterを用い、URLを再読込しても404にならない。
- 初期公開は研究データが未接続の**第1工程UIのみ**。正式な数理計算や生物移動の結果を示さない。

詳細は [Pages公開手順・検証](docs/15-github-pages-release.md)。公開リポジトリと公開サイトは別の設定です。

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

**重要：ここでのテスト成功は新アプリの研究エンジンや実地データの動作確認を意味しません。**

## リポジトリの作成

新しい独立リポジトリは [yumotof01-dotcom/ECO-MIRROR-3](https://github.com/yumotof01-dotcom/ECO-MIRROR-3) に作成済みです。コンテスト提出のため公開リポジトリへ変更する方針ですが、実際の公開状態は GitHub のリポジトリ設定で確認してください。アップロードするのは本設計資産であり、研究エンジンの移植や公開Webアプリの完成ではありません。手順は [GitHubセットアップ](docs/11-github-setup.md)。

## 出典

- 元の研究コードと検証：[旧 ECO-MIRROR、Draft PR #20](https://github.com/yumotof01-dotcom/ECO-MIRROR/pull/20)
- 土地被覆：[ESA WorldCover 2021 v200](https://esa-worldcover.org/en/data-access)、CC BY 4.0。

現段階で新アプリに採用するソフトウェアライセンスは未決定です。第三者データのライセンスは別途尊重します。
