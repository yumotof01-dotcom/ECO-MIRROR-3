# ECO MIRROR 3.0｜Cloudflare Pagesで第1工程UIを公開する

更新：2026-11-06。

## なぜCloudflare Pagesに切り替えたのか

GitHub Pagesのデプロイは`build-and-deploy`ジョブが実行開始前（ステップなし、数秒）に失敗。PagesのSource設定はGitHub Actionsで保存済みだが、環境の制約などジョブ開始前に失敗する**厳密な理由は未確定**。Browser Useも連携サービスの利用枠不足で起動できず、追加課金をしないため、GitHub Pagesへの自動プッシュを停止した。設定や権限の無根拠な緩和は行わない。

Cloudflare Pagesには既存GitHubリポジトリを直接連携する無料の静的ホスティング経路がある。既存Reactアプリは新たな有料API、Cloudflare APIトークン、データベース、Workersを必要としない。

## 現時点でGitHubに実装してあるもの

- React/TypeScript/Viteのビルド済みアプリが実行できる（既存第1工程の自動テスト10件成功）。
- `.node-version` に `24.22.1` を指定。Cloudflare Pagesの標準Node.js 22はこのアプリの `>=24.12.0` 要件に不足するため、バージョンを明示する。
- `vite.config.ts` は `GITHUB_PAGES_DEPLOY=true` のときだけGitHub Pagesの `/ECO-MIRROR-3/` を使う。Cloudflareではこの環境変数を設定せず通常の `/` でビルドする。
- `src/main.tsx` はHashRouterを使用しており、`/#/explore` と `/#/evidence` の直接リンクが成立する。
- `scripts/assert-cloudflare-build.mjs` とGitHub Actionsの設計CIで、CloudflareのルートURLに必要なJS/CSSファイルとHTMLの参照をチェックする。
- GitHub Pages用ワークフローは削除せず、`workflow_dispatch`での手動起動のみに変更。自動実行で繰り返し失敗させない。

**更新：Cloudflare Pagesプロジェクト「eco-mirror-3」はGitHub連携済み。ただしサイトは正常にビルドされていない。**
GitHub Actionsの外部HTTP診断で、2026-11-06時点の結果を取得した。
- `https://eco-mirror-3.pages.dev/` と初期リンク `https://e0542378.eco-mirror-3.pages.dev/` は **HTTP 404・HTMLなし**。
- CloudflareがGitHubの`feat/phase1-react-app-shell-2026-11`ブランチについて成功表示したプレビュー `https://feat-phase1-react-app-shell.eco-mirror-3.pages.dev/` および `https://ca35856a.eco-mirror-3.pages.dev/` は **HTTP 200** だが、返されたHTMLはソースの`index.html`そのもの（`/src/main.tsx`を直接参照）。ビルド後の`/assets/*.js`と`/assets/*.css`がないためReactが起動できず白画面になる。
- これはViteアプリ内部の例外ではなく**Cloudflareがビルド成果物`dist/`を配信していない**事象。CIではViteビルドとCSS/JS成果物検証が通っている。

## 既存のCloudflare Pagesプロジェクトの修正（新規プロジェクトの作成不要）

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/) → **Workers & Pages** → **eco-mirror-3** → **Settings** → **Builds**（または **Builds & deployments**）を開く。
2. **Build configuration** で **Build command = `npm run build`、Build output directory = `dist`、Root directory = リポジトリ直下**にする。Cloudflare公式のReact (Vite)設定と一致させる。
3. **Branch control → Production branch** は **`feat/phase1-react-app-shell-2026-11`**を選択する。現在はこのブランチがプレビューURLとして扱われ、通常公開URL側は404であり、本番ブランチが異なる可能性が高い。
4. **Node version** は `.node-version`を参照するか、Build環境変数`NODE_VERSION=24.22.1`を指定する（既存環境にバージョンがあれば不要）。`GITHUB_PAGES_DEPLOY`は設定しない。
5. 保存後に **Deployments** から該当ブランチを**Retry deployment** するか、新規コミットを再デプロイする。成功後、HTMLに`/assets/*.js`と`/assets/*.css`の参照があり、どちらもHTTP 200であることを確認する。

**Cloudflare側の設定変更はアカウント所有者の操作が必要。まだ公開成功を宣言しない。**

## 参考：プロジェクトを新規に作成する場合だけの手順

## iPadのSafariから1回だけ行う操作

1. https://dash.cloudflare.com/ を開いてログイン。Cloudflare Pagesを利用できるアカウントを選択。
2. 左メニューの **Workers & Pages** → **Create application** → **Pages** → **Connect to Git / Import an existing Git repository** を選択。表示はアップデートで若干異なる。
3. GitHub認可が求められたら、内容を確認して **yumotof01-dotcom/ECO-MIRROR-3** のみにアクセスを付与（旧 `ECO-MIRROR` 全体への権限は不要）。
4. リポジトリ **ECO-MIRROR-3** を選択し、**Production branchを必ず `feat/phase1-react-app-shell-2026-11` にする**。現時点の`main`にはReactのアプリ本体がなく、設計スターターしかない。自動の`main`をそのまま採用しない。
5. Build設定を次のとおり入力する。

| 設定欄 | 入力 |
|---|---|
| Framework preset | React (Vite) または Vite |
| Production branch | `feat/phase1-react-app-shell-2026-11` |
| Root directory | リポジトリのルート `/`（設定欄があれば） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable `NODE_VERSION` | `24.22.1`（`.node-version` が読まれない環境で必要。事前に設定してもよい） |
| `GITHUB_PAGES_DEPLOY` | **設定しない** |
| Project name | `eco-mirror-3` など使用できる名前 |

6. 不要な有料オプション、カスタムドメイン、データベース、Workers設定は追加せず **Save and Deploy / Deploy**。
7. 成功画面で表示される**実際の**`*.pages.dev`のURLを開き、ホーム→研究ワークスペース→根拠を試す。共有URLの末尾に`/#/explore`を付けると探索モードに直接アクセスできる。

## 公開確認の合格基準

- CloudflareのDeploymentがSuccess、Productionが正しい開発ブランチのコミットを参照している。
- Safariでホームページが開く。ブラウザのコンソールや画面に404、真っ白な画面、崩れたCSSがない。
- `/#/explore`で4つの研究モードと6地域が切り替わる。
- `/#/evidence`に出典と研究上の限界がある。
- **2021年の土地被覆実データ・440条件の計算・動物の移動はまだ新アプリに未接続**と明記されている。
- 実機Safari/VoiceOver/モバイル表示は別途確認し、CIビルド成功だけで完全対応と断言しない。

## 後日`main`にマージする場合

Draft PR #1のレビュー・承認・マージは独立した操作。現在はマージしない。将来`main`が実アプリを含むようになったら、Cloudflareの **Settings → Builds → Branch control** でProduction branchを`main`に切り替えることを検討する。現在のプレビューを利用するためだけに旧アプリや新リポジトリ`main`を変更しない。

参考：
- Cloudflare公式 Git連携 https://developers.cloudflare.com/pages/configuration/git-integration/
- Cloudflare公式 React (Vite) https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- Cloudflare公式 Build image / Node.js version https://developers.cloudflare.com/pages/configuration/build-image/
