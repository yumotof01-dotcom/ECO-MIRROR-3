# ECO MIRROR 3.0

> 自然のつながりを、見る。試す。確かめる。

**状態：第3工程の静的研究パッケージと、UI・UX設計前の準備①〜⑤を実装。**
更新：2026-11-06。旧研究エンジン原本移植と実データ一致検証に成功し、第0工程の設計基盤、第1工程のReact骨格も保持しています。

6地域の2021年研究データは静的配信され、研究根拠ページに検証用パネルがあります。正式な探索地図、440条件比較、自然の橋の操作画面は未接続です。デザイン専用プロトタイプと研究用機能を区別してください。

## 現在の作業場所

- `main`：第0工程の初期設計。
- `feat/phase1-react-app-shell-2026-11`：第1工程。Cloudflare本番用として記録されたブランチ。
- `feat/phase2-landscape-engine-import-2026-11`：第2工程。原本移植・全件一致。
- `feat/phase3-static-study-packages-2026-11`：第3工程。115ファイルの配信・検証パネル。
- `feat/pre-ui-foundation-steps1-5-2026-11`：第3工程から分岐した今回の準備①〜⑤。

PR #1〜#3 は本作業開始時点でDraft・未マージです。READMEと工程表だけで公開先の実装状態を判断せず、対象ブランチとコミットを確認します。今回の準備①〜⑤は既存ロードマップ第1〜5工程とは別の番号です。

## できていること

| 範囲 | 実装・根拠 |
|---|---|
| アプリ骨格 | ホーム・探索・研究根拠・404、地域・研究モード切替 |
| 研究エンジン | 16ファイル原本一致、旧版との3,080条件と42,240介入比較の全バイト一致。第2工程の検証記録を参照 |
| 第3工程 | 6地域、2,640条件、42,240介入比較を115ファイルで静的配布。取得時にSHA-256検証 |
| 準備① | 最新の実装・文書・工程番号・作業ブランチを整理 |
| 準備② | リリースマニフェストをコード側SHA-256で固定。原分類と植生マスク、出典、年、座標、候補面積を照合 |
| 準備③ | 440条件の厳密選択、比較、地域別の不変モデル、地域切替時の古い結果排除 |
| 準備④ | 元分類・仮想除去・4/8近傍のパッチ・投影座標・凡例・候補範囲をWorkerで準備 |
| 準備⑤ | 40曲線の急変区間診断、PC増分とパッチ結合の分離、同面積候補比較、全条件照合 |

詳細と合格条件：[UI設計前の基盤仕様](docs/19-pre-ui-foundation.md)。検証記録：[準備①〜⑤の結果](docs/20-pre-ui-validation.md)。

## 開発と検証

Node.js 24.12以上とnpmを使用します。有料APIキーは不要です。

```bash
npm ci
npm run dev
npm run check
npm run research:audit
npm run research:build
```

`research:audit`は115ファイルの復元監査と、実データ2,640条件・240曲線・42,240介入結果・264地図フレームの照合を実行します。`research:build`は後のUI向けAPIとmodule Workerを別の`dist-research/`へ出力します。通常の公開アプリのUI・CSS・配信先は変更しません。

本物のブラウザでのWorker検証は`npm run research:browser`。Playwright 1.62.1とChromiumが必要で、専用GitHub Actionsが一時的に導入して実行します。アプリの実行依存には追加していません。ローカル環境の制約とCIでの結果は検証記録に分けて記載します。

## 科学・運用上の原則

- **観測 / 構造モデル / 仮定 / 未検証**を区別します。PCは植生候補パッチと重心距離の構造的な指標です。
- ESA WorldCover 2021 v200は2026年の現況、生物の実移動、生息、送粉を実証しません。
- 440条件は固定された仮定の感度分析であり、未来の440通りの確率ではありません。
- 最大低下区間は生態系崩壊・絶滅の閾値ではありません。
- 400㎡の仮想変換は現実の緑化推薦ではありません。候補順位は12地点の選定集合内の比較です。
- 欠損・未計算・不適用・失敗を0に置換しません。
- 旧`ECO-MIRROR`を保持し、固定版の原本エンジンを変更しません。元CSV 3,882件や旧UIはMVPへ移植しません。
- アプリ内生成AI API、追加の必須有料API、ログイン、追跡を設けません。

研究CLIが動くことは、ブラウザで実データを操作できることや、生物学的な妥当性の証明を意味しません。iPad/Safari実機、読み上げ、低性能端末、正式画面への統合は今後の検証です。

## 参照資料

- [製品仕様](docs/01-product-spec.md) / [情報設計](docs/02-information-architecture.md) / [初期デザイン](docs/03-design-system.md)
- [技術構成](docs/04-architecture.md) / [科学・データ契約](docs/05-science-data-contract.md)
- [移植計画](docs/06-migration-plan.md) / [テスト計画](docs/07-test-plan.md) / [工程表](docs/08-milestones.md)
- [第2工程の実行済み照合結果](docs/18-phase2-validation-results.md)
- [Cloudflareの公開・障害対応履歴](docs/16-cloudflare-pages-release.md)
- `design/prototype.html`：静的な画面案。実データ未接続。
- `contracts/`：初期提案JSON Schema。新しい研究APIの仕様は文書19を参照。
- `FILE_MANIFEST_SHA256.json`：第0工程の配布時点の記録。現在の全ファイルのライブ索引ではありません。

## 出典

- 元研究：[旧ECO-MIRROR Draft PR #20](https://github.com/yumotof01-dotcom/ECO-MIRROR/pull/20)、固定コミット`9a7fa63bc83f350c80ddf775124cd3cbeb6c112e`。
- 土地被覆：[ESA WorldCover 2021 v200](https://doi.org/10.5281/zenodo.7254221)、CC BY 4.0。各データと画面用モデルに帰属情報を保持。
- 新リポジトリ：[yumotof01-dotcom/ECO-MIRROR-3](https://github.com/yumotof01-dotcom/ECO-MIRROR-3)。Public化は確認済み。ソフトウェア自体のライセンスは未決定です。
