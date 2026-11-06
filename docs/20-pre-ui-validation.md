# 20｜UI設計前の準備①〜⑤：検証記録

日付：2026-11-06。基準：第3工程`3011d8249d2bc07d1be4053b36abbd0e04585a33`。
作業ブランチ：`feat/pre-ui-foundation-steps1-5-2026-11`。

## 実データによる照合

- 6地域のリリース固定SHA検証付き取得とファイル間意味検証。
- 2,640/2,640条件の選択結果が元の配信レコードと一致。
- 240/240曲線を11点ずつ取り出し、配布済み診断を原本関数の再診断と照合。
- 96地点×440＝42,240/42,240の介入結果を新APIから取得し、元レコードと一致。
- 31,870件ではPC増加とパッチ非結合が同時に生じ、表示用分類でも区別できることを確認。
- 264/264地図フレーム（6地域×2規則×11除去率×2近傍）、延べ10,560,000セル。元エンジンのマスク・パッチ数・面積・重心と一致。
- 西北・東南の画素範囲、投影座標の南北方向、候補4画素の400㎡を確認。
- 既存静的配布監査：115ファイル、2,640条件、42,240介入結果、元レポート再構成SHAに合格。

これは**新しいデータ準備層と既存研究結果の照合**。研究全体の生態学的妥当性を実証したものではない。
旧版との3,080条件＋42,240結果の数値・全バイト一致は第2工程の既存記録。今回原本エンジンは変更せず、その検証を引き継ぐ。

## 異常・境界条件

マニフェスト置換、改変バイト、404、条件IDと設定の不一致、NaN、面積・実除去率の偽装、診断改変、重複/範囲外の候補画素、トポロジー説明の矛盾、投影原点の非有限値、未知分類、順位破損、別地域の介入結果、未知地点を拒否。
地域切替の古い要求、通信失敗、取消、clearで、他地域の結果が残らないことを確認。
Workerの成功・外国地域応答・処理エラー・messageerror・クラッシュ・postMessage失敗・事前取消・処理中取消・30秒タイムアウト・Worker非対応を確認。

既存loaderがfetcherのStudyIntegrityErrorを全てNETWORKへ変換し、固定SHA不一致の原因を失わせることを新テストで再現した。変更は既知のStudyIntegrityErrorと取消を保つcatch処理に限定。既存利用箇所を回帰検証する。

## 再実行コマンド

```bash
npm ci
npm run check
npm run research:audit
npm run research:build
```

実ブラウザでバンドル済みmodule Workerを検証する場合：

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium
npm run research:browser
```

`.github/workflows/pre-ui-foundation.yml`が専用のブラウザ検証を実行する。初回ローカル環境ではChromiumがOSのsocket制約で起動できなかったため、ローカルでのブラウザ成功とは記録しない。GitHub Actionsで実ブラウザ検証が成功した（下記）。

## 変更範囲と未完了

既存研究コア16ファイルと公開データ115ファイル、既存App/CSS、旧リポジトリ、main、Cloudflare本番設定は変更しない。
新APIとWorkerは独立ビルド。正式な探索UIへの接続、保存・再読込、iPad/Safari実機、読み上げ、低性能端末、現地の生態学的検証は未完了。
「妥協なく網羅」は上記の定義済み6地域・440条件・96候補・264格子の範囲で判定する。任意地域や未定義条件の網羅、無欠陥や生物学的正確性の保証とはしない。


## GitHub Actionsでの成功記録

対象コミット：`069f051c0215ae5a4ced724a4407d995873d0aa6`。

- [専用の実データ・バンドルWorker監査](https://github.com/yumotof01-dotcom/ECO-MIRROR-3/actions/runs/42215241872)：SUCCESS。
- [既存の全テスト・型検査・ビルド・配信アセット監査](https://github.com/yumotof01-dotcom/ECO-MIRROR-3/actions/runs/42215241894)：SUCCESS（設計5件＋Vitest48件＝53件）。
- Chromiumで6地域すべてのデータ取得、Workerによる地図準備、同面積候補比較、取消、Worker非対応時の失敗を確認。メインスレッドのタイマー継続も確認。
- 原本16ファイルはGit blob SHA-1が全件一致。データ115ファイルとApp/CSSに変更なし。

追加の境界テスト：PC=0でも計算済み値0を保持し、相対変化のみnull/undefined_zero_baselineとする。通信本文の失敗と同時に取消が起きてもAbortErrorを保つ。Worker時間の計測範囲は地図準備だけに限定する。
これらを含む最終コミットのCIは同PRのChecksで追跡する。
