# ECO MIRROR 3.0｜GitHub Pages公開の設定と検証

## 目的

新アプリの第1工程React SPAをGitHub Pagesに無料の静的サイトとして配信し、iPadのSafariで操作できるようにする。研究用の440条件や土地被覆データは**未接続**であり、サイト公開は科学的な研究結果の公開・モデルの検証と別である。

- 公開用URL（設定成功後）：https://yumotof01-dotcom.github.io/ECO-MIRROR-3/
- 探索ページ：上記URLの後ろに `#/explore` を付ける。
- 根拠ページ：上記URLの後ろに `#/evidence` を付ける。
- HashRouterを採用し、GitHub Pagesの静的配信で深いリンクを再読み込みしても404にならないようにした。
- GitHub PagesビルドでのみViteの `base` を `/ECO-MIRROR-3/` に設定。通常の `npm run dev` は `/` に保つ。

## ユーザーが一度だけ行う設定

1. GitHubへログインして **https://github.com/yumotof01-dotcom/ECO-MIRROR-3/settings/pages** を開く。
2. 「**Build and deployment**」→「**Source**」を確認。
3. **GitHub Actions**を選ぶ（`Deploy from a branch` ではない）。
4. GitHub Actionsの [Deploy ECO MIRROR 3.0 to GitHub Pages](https://github.com/yumotof01-dotcom/ECO-MIRROR-3/actions/workflows/deploy-pages.yml) を開き、失敗した直近の実行を選択して **Re-run all jobs** で再実行する（または、このチャットで「Pagesを有効化した」と伝え、新しいコミットで再実行する）。非デフォルトブランチのワークフローは `Run workflow` ボタンが表示されない場合がある。
5. Actionsの `build-and-deploy` ジョブが成功した後に、上記の公開URLをSafariで開いて、ホーム→探索→根拠を試す。

**重要：** 本書作成時点ではGitHub Pagesのサイトは未作成。GitHub Actionsで `Configure GitHub Pages` ステップに `Get Pages site failed ... repository has Pages enabled and configured to build using GitHub Actions` というエラーが返っており、ユーザーの設定を待っている。設定前に公開済みとは宣言しない。

## ソース・ワークフローの検証

- ワークフロー：`.github/workflows/deploy-pages.yml`。
- 有効なブランチ：`feat/phase1-react-app-shell-2026-11` と、将来PRがレビューされマージされた場合の `main`。
- 権限：`contents: read`、`pages: write`、`id-token: write` のみ。認証トークンや秘密鍵はコードに埋め込まない。
- `npm ci`・`npm run check`（設計検査＋Node/Vitest 10件＋型検査＋ビルド）。
- GitHub Pages向け本番ビルドは `GITHUB_PAGES_DEPLOY=true npm run build`。
- `node scripts/assert-pages-build.mjs` が出力HTMLの絶対パスすべてに `/ECO-MIRROR-3/` が付き、該当アセットが実際に存在することをチェックする。
- GitHub Actions標準の`actions/configure-pages` / `upload-pages-artifact` / `deploy-pages` を使用する。
- ページが公開されたら、実際のURLを別途HTTPで確認すること。CI上のビルドが成功しただけで公開確認済みとは言わない。

## 今後の変更と公開

- 現在のコードは **Draft PR #1** の作業ブランチにある。mainへのマージは行わないままブランチからデプロイする。
- 公開されるページは第1工程のアプリ画面。研究データ未接続の表示を残す。
- 本番利用者のブラウザ・VoiceOver・Safari・スマホ性能は公開後に実機確認する。
- GitHub Pagesに設置するのはコンパイル済みの `dist` だけ。リポジトリ内の研究用未完成JSONやローカル秘密情報は配布しない。

出典：Vite公式ドキュメント https://vite.dev/guide/static-deploy.html および GitHub公式ActionsのPagesドキュメント。

## 初回設定の確認記録（2026-11-06）

GitHubの設定画面で「GitHub Pages source saved.」が表示され、Build and deployment の Source が GitHub Actions になっていることを確認した。設定画面上で確認できたのは**公開方法の保存**であり、サイトの実際の公開成功ではない。

設定保存後のワークフロー再実行は**failure**で終了。再実行のジョブ詳細ログをAPIから取得できていないため、以前の404が同じ理由で発生したと断定しない。新しいpushで再検証し、それでも失敗した場合はGitHub Actionsの「build-and-deploy」ジョブの最初のエラー表示を調べる。
