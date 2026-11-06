# ECO MIRROR 3.0

> 自然のつながりを、見る。試す。確かめる。

**状態：新アプリの設計基盤 v0.1（2026-11-06）。実装済みの研究エンジンや実データは、この新しいフォルダーにはまだ移植していません。**

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
