# 19｜UI・UX設計前の準備①〜⑤

更新：2026-11-06。基準コミット：第3工程 `3011d8249d2bc07d1be4053b36abbd0e04585a33`。

## 範囲と完了の意味

利用者の直前の依頼で整理した準備①〜⑤を実装する。既存ロードマップの第1〜5工程ではない。
完成対象は**UIから安全に使える研究データ・比較・格子の準備層**。正式な探索地図、画面レイアウト、配色、動き、保存機能、実機検証全体の完成は含めない。

| 準備 | 対応する実装 | 合格条件 |
|---|---|---|
| ① 現状・仕様整理 | README、工程表、技術構成、文書19/20 | main・第1〜3工程・今回の作業場所と未接続範囲を区別 |
| ② データ基盤確認 | `study.ts`、`validation.ts`、既存loader | 配信マニフェストがコード固定SHAと一致。原分類・マスク・座標・出典・条件・候補が整合 |
| ③ 共通処理 | `conditions.ts`、`ResearchStudy`、`session.ts` | 440条件を厳密選択。地域切替で古いデータを排除。比較が同じ地域・版に束縛 |
| ④ 地図用データ | `mapData.ts`、`map.worker.ts`、`mapWorkerClient.ts` | 6地域×2規則×11除去率×2近傍＝264フレームが原本エンジンと一致 |
| ⑤ 比較・急変区間・自然の橋 | `ResearchStudy`のcurve/intervention/compareCandidates | 240曲線と42,240介入結果を保持し、PC増加とトポロジー変化を独立取得 |

## データの入口と信頼範囲

`loadResearchStudy(regionId, options?)`を使う。順序は以下。

1. コードに固定したマニフェストSHA-256 `cddd22e498612611be888a691b5ee5ab637cfcf56539522fec3bb051912c57b5`と取得バイトを照合。
2. 既存loaderで対象地域のcrop・baseline・summaryのサイズ/ハッシュ、原分類・マスクのハッシュ、440条件と16候補を検証。
3. 条件IDと実際の設定、元分類→植生マスク、分類ヒストグラム、投影原点、シナリオ面積・実除去率、40曲線の再診断を照合。
4. 各候補の2×2範囲、原分類50/60、400㎡、4/8近傍の説明、12候補と4参照地点、順位・出典を確認。
5. オブジェクトグラフを複製して再帰的にfreeze。1モデルは1地域・1データ版に束縛。

ハッシュはファイル整合性の検査である。コードとデータの配信元自体が侵害された場合の真正性や、現地の生物学的正しさを保証する仕組みではない。
更新リリースはデータ・固定SHA・再現監査を同じレビューで更新する。未知の版を自動受理しない。
`ResearchStudy.fromVerified`は既存loaderで検証済みのオブジェクトを受ける低水準入口。任意JSONの真正性確認やネットワークハッシュ検証を代替しない。

## UIから使うAPI

公開入口：`src/research/index.ts`。

| API | 結果と制約 |
|---|---|
| `loadResearchStudy(regionId)` | 6地域のみ。失敗時はrejectし、0や他地域で代用しない |
| `CONDITIONS` / `CONDITION_AXES` | 固定440条件と各軸。配列も不変 |
| `condition(selectionOrId)` | 正確な1条件。近い値への丸め、補間、IDの曖昧な解釈なし |
| `conditions(filter)` | 規定軸の部分指定。元の決定的な条件順を保持。未知軸/値は失敗 |
| `compare(a,b)` | 同地域・同版内の差。変更した軸を列挙。基準PC=0の相対変化はnullと理由を返す |
| `curve({pattern,neighbourhood,lambdaMetres})` | 11点と原本の診断。生態学的閾値は未検証 |
| `rankedCandidates(directInBothNeighbourhoods?)` | 12候補内の固定順位。参照4地点を推薦順位に混入しない |
| `loadResearchSite(study,siteId)` | 必要になった1地点の440結果を遅延取得。基準・差・面積・近傍別パッチ数・要約を照合 |
| `intervention(site,condition)` | PC効果increase/decrease/within_toleranceと、patch_merger/new_island/unchanged_patch_countを別々に取得 |
| `compareCandidates(a,b,condition)` | 同地域・同条件・同面積400㎡の候補差。現実の推薦とは解釈しない |
| `candidateFootprint(study,siteId)` | 原分類と4画素の投影矩形。土地権利・施工可能性はnot_assessed |
| `prepareResearchMap(study,selection,signal?)` | Workerで元分類・仮想除去・連結パッチを準備。メインスレッドの代替同期計算なし |
| `ResearchSession.select/cancel/clear` | loading/ready/error/cancelled/idleの状態。新しい選択開始で前地域の結果を消し、古い完了を無視 |

返すprovenanceにはリリースID・マニフェストSHA・旧研究固定コミット・データセットID・原分類/マスクSHA・CRS・対象年・出典URL・帰属・ライセンス・注意事項を保持。
比較は複数の軸を変更できるが、changedAxesを表示側で確認する。因果関係を証明する比較ではない。

## 地図データ契約

- 固定200×200、1画素10m。原点は元データの`projected_northwest_metres`。
- 座標は元取込処理の`always_xy=True`に対応する**東向きeasting、北向きnorthing**。列は東へ、行は南へ増加する。EPSGのネイティブ軸順をそのまま利用しない。
- 画素の西端＝原点E＋列×10、北端＝原点N−行×10。セル中心はそれぞれ＋5、−5。
- 旧エンジンのローカル重心Yは下向き正。そのため投影N＝北西原点N−ローカル重心Y。
- `originalClasses`は元のESA分類で、仮想除去しても書き換えない。
- `displayMask`：0＝元のその他、1＝残った植生候補、2＝仮想除去した植生候補。欠損はこの分類へ変換せず入口で失敗。
- `patchLabels`：0＝植生パッチなし、1以上＝選んだ4/8近傍における連結成分。IDは地域・条件が変わると再採番され、時系列の個体IDではない。
- lambdaは重心距離モデルの仮説パラメータであり、格子やパッチラベルを変えない。MapSelectionにlambdaを含めない。
- 元分類の集計と日本語ラベルを返し、後の凡例・表形式代替に使える。正式な色・描画法はまだ決めない。
- 生物の実移動線や受粉経路を生成しない。緯度経度への逆投影や背景地図との重ね合わせは今回実装しない。

## 処理と取消

重いマスク生成と連結成分抽出はmodule Worker専用。Workerへ渡す原分類配列と、返す3配列をtransferし、不要なコピーを減らす。
1要求につき1Workerを起動し、成功・失敗・取消・30秒タイムアウトの全経路でterminateする。取消はAbortError。
Worker非対応時は明示的に失敗し、UIスレッドへ処理を移さない。結果の地域・データセット・SHA・条件が要求と違う場合は失敗。
`ResearchSession`は要求番号とAbortControllerで古いネットワーク完了を破棄。選択変更時に結果を0へ置き換えない。

## 数理と解釈

原本の`src/features/landscape`と16ファイルは変更しない。新たな数理モデルや実験IDを作らず、元の440条件を保持する。
40曲線の診断を既存関数で再生成して配布済み診断と照合する。最大低下区間とモデル急変フラグを現地の絶滅・崩壊と同一視しない。
PC増分の符号は原本と同じ1e-12許容差。patch mergerはbefore/afterの連結成分数で別判定する。
元の候補選定で4/8両方に結合する地点であっても、植生除去後の各条件で必ず結合するとは限らない。その条件の結果を表示する。

## 後続工程

準備⑥：出典・条件・結果を保存して再読込できる形式。
準備⑦：実機iPad/Safari、端末負荷、ネットワーク・取消の統合検証。
準備⑧：正式UIの表示項目・操作・状態を確定。情報設計→ワイヤーフレーム→操作評価→配色/形/動きへ進む。
今回のWorkerスモークテストは⑦の一部を先行する技術確認で、実機検証の代替ではない。
