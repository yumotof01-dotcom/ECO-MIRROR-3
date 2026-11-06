# 11｜GitHub配置・Public公開の操作手順

## 新リポジトリ

新しい独立リポジトリは [yumotof01-dotcom/ECO-MIRROR-3](https://github.com/yumotof01-dotcom/ECO-MIRROR-3) に作成済み。旧 [ECO-MIRROR](https://github.com/yumotof01-dotcom/ECO-MIRROR) とは別物で、旧リポジトリの研究PR #20はDraftのまま残します。

2026-11-06、利用者はコンテスト審査に向けて **新リポジトリを Public にすることを承認**しました。公開設定が反映されたかどうかはGitHub上で確認する必要があります。

## 公開設定の変更

1. GitHubで新リポジトリ（`ECO-MIRROR-3`）を開く。
2. 上部の **Settings** → **General** を開く。
3. 下部 **Danger Zone** → **Change repository visibility**（または **Change visibility**）を選ぶ。
4. **Make public** を選択し、警告を読んで表示されるリポジトリ名の確認操作を行う。
5. リポジトリ上部の **Public** 表示と、未ログイン状態でREADMEを読めることを確認する。

**公開すると、README・設計図・ソースコード・Git履歴・GitHub Actionsログ等が閲覧可能**。リポジトリに秘密情報・連絡先・個人情報・未許諾ファイルが混じっていないことを変更前に確認する。公開後にPrivateへ戻しても閲覧済みの内容やフォークを消せるとは限らない。

## 設計スターターの配置

このGitHubリポジトリには小さな初期READMEが先に存在します。GitHubへのアップロードでは既存のREADMEを読んで、新しいREADMEへ**明示的に更新**し、無関係のファイルを上書きしないでください。推奨構成：

- README.md / AGENTS.md
- docs/ / contracts/ / design/
- tools/ / tests/ / package.json
- .github/workflows/design-audit.yml / .gitignore

設計資産のアップロードと新アプリのコード完成は別の段階。追加の有料APIやサーバーを導入しない。

## 初期のローカル検証

Node.js 20以上を使い、GitHubへ配置済みのリポジトリをクローンして実行：

```powershell
git clone https://github.com/yumotof01-dotcom/ECO-MIRROR-3.git
cd ECO-MIRROR-3
npm run design:check
npm test
python -m http.server 8000
```

ブラウザで `http://localhost:8000/design/prototype.html` を開く。ここに描かれた画面は **研究データを接続していないデザイン専用の試作品**であり、実際の地図・未来予測・ハナバチの移動ではない。

### 科学・権利上の制約

- NASA等の別データではなく、元の研究対象は **ESA WorldCover 2021 v200**（CC BY 4.0）。表示時は帰属を明記。
- この新リポジトリではコードのOSSライセンスは未決定。無断でMIT等を追加しない。
- 440条件は数理的な感度分析であって、440通りの未来確率ではない。
- 新リポジトリがPublicでも公開Webアプリのデプロイが完了したことにはならない。
