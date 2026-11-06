# 22｜準備⑦：統合検証と判定範囲

更新：2026-11-06。対象は準備①〜⑥のAPI・バンドルWorkerと、既存Reactシェル。

## 自動検証の範囲

| 項目 | 検査方法 | 判定対象 |
|---|---|---|
| 型・テスト・ビルド | npm run check | 実装・既存画面の回帰 |
| 元データと全条件 | research:audit | 115ファイル、2,640条件、240曲線、42,240介入、264地図フレーム |
| 保存・再読込 | 6地域×5種類 | チェックサム・出典・結果の厳密一致 |
| 形式互換 | Python jsonschema 4.26.0 | ビルド済みAPIの30出力と30年偽装 |
| エンジン互換 | Playwright 1.62.1 | Chromium / Firefox / WebKit |
| 画面幅 | 1280×900 / 1024×1366 / 390×844 | desktop / tablet emulation / phone emulation |
| ファイル操作 | 実ダウンロード→File入力→再照合 | Blob/ファイル名/読込API |
| 通信失敗 | リクエストを遮断 | 前地域の値を消し、errorで停止 |
| データ破損 | baselineを{}へ置換 | HASH_MISMATCHで結果拒否 |
| 遅い古い地域 | 新宿のcropを150ms遅延して大阪へ切替 | 最後に選んだ大阪だけready |
| 条件変更 | ResearchMapSessionでWorker要求を重ねる | 前のフレームを消し、古い完了を無視 |
| 取消 | 各プロファイルで10Workerを取消 | AbortError・解放・後続要求成功 |
| キーボード | 既存4タブの矢印・End | 選択属性と操作の整合 |
| 既存根拠ページ | 実データ検証パネルの操作 | SHA-256成功表示 |
| 横方向のはみ出し | 各画面幅でscrollWidthを検査 | 既存探索/根拠ページの基本レスポンシブ |

3エンジン×3画面幅＝9プロファイル。それぞれ30件、計270件の保存結果を再照合する。
`WebKit`や`tablet_emulation`の成功は、物理iPadのSafari成功とは区別する。Firefoxのモバイル設定は画面幅のエミュレーションであり、モバイル版Firefoxを動かした証拠ではない。

## CPU・メモリの限定計測

Chromiumのdesktopプロファイルで以下を実施。

- DevToolsでCPUを4倍抑制し、20回の地図Workerを順次起動・終了。
- 128MiBのrenderer V8ヒープ上限フラグを設定。
- GC後のmain-thread JS heapを前後で測定し、増分32MiB未満を検査。
- 時間・ヒープ・ブラウザ情報をJSONのCI成果物へ記録。

これは**メインスレッドのヒープ残留の限定検査**。Workerのピークヒープ、OS全体のRSS、実際の端末RAM不足、GPU、電池、長時間運用を測定したものではない。V8フラグは「128MiB端末で動いた」ことを意味しない。
対象地図は固定40,000セル。全研究のPC再計算はブラウザへ持ち込まない。

## 再実行

```bash
npm ci
npm run check
npm run research:audit
npm run research:build
python -m pip install jsonschema==4.26.0
node scripts/research/write-snapshot-examples.mjs
python scripts/research/audit_snapshot_schema.py
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium firefox webkit
RESEARCH_BROWSER=chromium npm run research:integration
RESEARCH_BROWSER=firefox npm run research:integration
RESEARCH_BROWSER=webkit npm run research:integration
```

専用CI：`.github/workflows/pre-ui-integration.yml`。成果物`pre-ui-integration-BROWSER`の保存期限は14日。検証仕様と結果の要約はこのリポジトリにも保持する。
手元の実行環境にはChromium起動のsocket制限があるため、実ブラウザ検証はGitHub Actionsで実行する。ローカルで実機検証したとは扱わない。

## 完了判定

準備⑦は「自動化できる統合検証」と「物理端末・支援技術」を分けて記録する。自動検証の成功はUI設計へ進む技術的な根拠になるが、全端末対応や製品全体の品質保証ではない。
物理iPad/Safari、VoiceOver、実低メモリ端末、長時間・中断復帰は[実機確認表](24-physical-device-checklist.md)で未実施として残す。
正式UIを作った後、そのUIのフォーカス順・読み上げ・表形式代替・動作軽減を再検証する。
