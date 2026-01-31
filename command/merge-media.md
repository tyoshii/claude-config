# /merge-media

カレントフォルダ内の動画・画像を1つの動画ファイルにまとめる。

## 出力仕様

- **解像度**: 1920x1080 (16:9 横動画)
- **縦動画/縦画像**: 左右を黒で埋めて中央配置
- **画像の表示時間**: 5秒
- **出力ファイル**: `YYYYMMDD.mp4`（例: `20260131.mp4`）
  - 同名ファイルが存在する場合: `YYYYMMDD-1.mp4`, `YYYYMMDD-2.mp4` と連番

## 対象ファイル

以下の拡張子を対象とする（大文字小文字不問）：

**動画**: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`
**画像**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

## 実行手順

### 1. ファイル収集

カレントディレクトリから対象ファイルを収集し、ファイル名順にソートする。

```bash
ls -1 | grep -iE '\.(mp4|mov|avi|mkv|webm|jpg|jpeg|png|gif|webp)$' | sort
```

### 2. 各ファイルを中間ファイルに変換

各ファイルを 1920x1080、黒パディング付きの中間ファイルに変換する。

**動画の場合:**
```bash
ffmpeg -i input.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1" -c:v libx264 -c:a aac -ar 48000 -ac 2 temp_N.mp4
```

**画像の場合（5秒の動画に変換）:**
```bash
ffmpeg -loop 1 -i input.jpg -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1" -c:v libx264 -t 5 -pix_fmt yuv420p -r 30 temp_N.mp4
```

### 3. 連結リストの作成

中間ファイルのリストを作成する：

```bash
# filelist.txt
file 'temp_1.mp4'
file 'temp_2.mp4'
file 'temp_3.mp4'
...
```

### 4. 出力ファイル名の決定

今日の日付から出力ファイル名を決定する：

```bash
# 基本ファイル名
base=$(date +%Y%m%d)

# 重複チェックして連番付与
if [ ! -e "${base}.mp4" ]; then
  output="${base}.mp4"
else
  n=1
  while [ -e "${base}-${n}.mp4" ]; do
    n=$((n + 1))
  done
  output="${base}-${n}.mp4"
fi
```

### 5. 動画の結合

```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy "$output"
```

### 6. クリーンアップ

中間ファイルと filelist.txt を削除する。

## 注意事項

- ffmpeg がインストールされていることを確認する
- 同名ファイルが存在する場合は自動で連番が付与される
- 音声がないファイルには無音トラックが追加される
- 処理前に対象ファイル一覧を表示し、確認を求める
