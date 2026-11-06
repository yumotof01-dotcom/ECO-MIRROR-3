# 13｜公式データの出典と権利

## ESA WorldCover

- 製品：ESA WorldCover 10m 2021 v200
- 提供者：ESA WorldCover consortium
- 年：**2021**（2026年ではない）
- 解像度：10m（分類地図）
- ライセンス：Creative Commons Attribution 4.0 International（CC BY 4.0）
- DOI：https://doi.org/10.5281/zenodo.7254221
- 公式Web：https://esa-worldcover.org/en/data-access
- 帰属表示：© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium

地図を再投影・切り出し・植生候補に変換した際の変更内容と計算結果を、出典とは別に表示する。元の3度タイル全体を取得/ハッシュしていなければ、派生窓の画素SHAを全元タイルのSHAと呼ばない。

**重要：** WorldCover 2020 v100 と2021 v200は作成アルゴリズムが異なる。両者の単純な画素差を土地利用の実変化と解釈しない。

## 旧ECO MIRROR研究の参照

- Repo： https://github.com/yumotof01-dotcom/ECO-MIRROR
- レビュー中： https://github.com/yumotof01-dotcom/ECO-MIRROR/pull/20
- 移植予定のソースの凍結リビジョン：9a7fa63bc83f350c80ddf775124cd3cbeb6c112e
- 旧研究の独立監査結果：6地域の2km窓および東京4km窓を用いた2026-11-06の検証。

この新設計パッケージにはESAの数値ラスタ・旧研究ソース・旧データを**まだ同梱していない**。移植の前に第三者のライセンス・使用条件を確認する。

## アプリのライセンス

新アプリ固有コードのライセンスは未決定。README、研究結果、UIの公開範囲も公開前の判断が必要。第三者ソースのライセンスと自分のコードのライセンスを混同しない。
