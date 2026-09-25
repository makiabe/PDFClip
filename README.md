# PDF Clip

PDFから必要なページだけを選択して、新しいPDFとしてダウンロードできるブラウザアプリです。

## 利用する

https://makiabe.github.io/PDFClip/

ブラウザから上記URLを開くだけで利用できます。

## 特徴

- PDFをドラッグ＆ドロップ
- ページのサムネイル表示
- クリックで複数ページ選択
- すべて選択 / 選択解除 / 奇数 / 偶数 / 反転
- `1-3, 5, 8-10` のようなページ番号指定
- 拡大プレビュー
- 選択ページだけを新しいPDFとしてダウンロード
- PDFはサーバーにアップロードせず、すべてブラウザ内で処理

## GitHub Pages

リポジトリの **Settings → Pages** で次を設定します。

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

## 使用ライブラリ

- PDF.js
- pdf-lib
