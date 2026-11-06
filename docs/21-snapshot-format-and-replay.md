# 21｜準備⑥：出典付き保存・再読込

更新：2026-11-06。入口：`src/research/snapshot.ts`、公開API：`src/research/index.ts`。
基準リリース：`worldcover-2021-v200-six-region-v1`、元データは2021年。

## 保存対象

| query.kind | 入力 | 保存する結果 |
|---|---|---|
| condition | 固定条件ID | PC、面積、実除去率と条件 |
| comparison | 基準と比較先の条件ID | 両条件・差・相対変化・変更軸 |
| curve | 規則・4/8近傍・lambda | 11点とモデル急変区間の診断 |
| intervention | 地点IDと条件ID | 400㎡追加前後、PC変化、パッチ結合の独立判定 |
| candidates | 2地点IDと同一条件ID | 同面積の候補差。現実の推薦ではない |

各結果にデータセットID、地域、マニフェストSHA、原分類/マスクSHA、旧研究コミット、モデル版、CRS、対象年、出典URL、帰属、ライセンス、未検証事項を結び付ける。
関係するcrop/baseline/summaryと選んだsiteのリソースパス・バイト数・SHAも保存する。地図の元ラスタや全42,240結果は埋め込まない。

## 形式

- `schemaVersion`: `eco3-research-snapshot-v1`。
- `producerContract`: `eco3-research-view-v1`。
- 外側に`canonicalization`、`sha256`、`payload`。payloadには`createdAt/provenance/resources/query/result`。
- `eco3-sorted-json-v1`はJSONオブジェクトのキーを再帰的に並べ、配列順とJSのJSON数値表現を保持する独自方式。RFC 8785への準拠を主張しない。
- payloadのUTF-8バイトのSHA-256。**電子署名ではない**。作成日時は保存時刻であり、土地被覆の観測年ではない。
- 最大128,000 UTF-8バイト、深さ24、ノード16,000。非有限数、undefined、危険なキー、未知版、未知条件、余分なトップ階層フィールドを拒否。
- 構造仕様：[research-snapshot.schema.json](../contracts/research-snapshot.schema.json)。バイト/深さ制限、ハッシュ、地域・条件対応、真正な結果との一致はアプリが追加検証する。

## 状態と信頼

1. `createResearchSnapshot(study, query)`：検証済みモデルから結果を取得。候補結果は必要な地点だけ取得。
2. `snapshotFile(snapshot)`：安全なファイル名とJSON Blobを返す。端末のダウンロードを使う。暗黙のアップロード・クラウド保存・localStorage書込はない。
3. `readResearchSnapshot(file)` / `parseResearchSnapshot(text)`：形式・サイズ・版・固定リリース・チェックサムを検査。ここでは**科学結果の再照合は未完了**。
4. `replayResearchSnapshot(text)`：アプリ自身の固定静的パッケージを読み、出典・関係ファイル・条件・結果を作り直して照合。
5. 一致した場合だけ`verified_replay`を返す。改変後にチェックサムを作り直しても、元結果と異なれば拒否。

ファイルに書かれたURLは取得しない。任意のJS/HTMLを実行せず、UIで生のインポート文字列をHTML化しない。
データ取得失敗時は「保存ファイルだけで確認済み」としない。検証失敗・欠損を0として扱わない。
再現には固定パッケージが到達可能な環境が必要。将来も同じURLの配信が続くことを保証しないため、第三者が完全オフラインで再確認する際は当該リリースのコード・静的パッケージ一式も確保する。
任意地域、未知データ版、自動バージョン移行、画面画像/PDF、全ラスタ同梱は今回の対象外。

## 利用例

```ts
const study = await loadResearchStudy('shinjuku');
const saved = await createResearchSnapshot(study, {
  kind: 'condition', conditionId: 'distributed-n4-lambda40-loss0'
});
const { filename, blob } = snapshotFile(saved);
// UIから利用者の保存操作に応じてダウンロード。URL.createObjectURLは完了後にrevokeする。
const restored = await replayResearchSnapshot(await selectedFile.text());
// restored.status === 'verified_replay' の場合のみ結果を表示。
```

## 検証

- 6地域×5種類＝30ファイルで保存→Blob→読込→元結果再照合。
- 2,640条件の結果をすべて保存・チェックサム再確認。
- 数値・出典・地域・警告・リソースSHAの改変、改変後の再ハッシュ、未知版、未来年偽装、過大ファイル、非有限数、過深JSON、取消、暗号API欠落、元データ不通を検証。
- 本番ビルドしたAPIの30出力を別言語のJSON Schema実装で検査し、30件の観測年偽装を拒否。
- ブラウザの実ダウンロードとファイル入力からの再読込も統合テストする。実行結果は文書22とPR #5を参照。
