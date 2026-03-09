# /merge-media

カレントフォルダ内の動画を1つの動画ファイルにまとめる。

## 出力仕様

- **解像度**: 1920x1080 (16:9 横動画)
- **縦動画**: 左右を黒で埋めて中央配置
- **出力ファイル**: `merged_YYYYMMDD.mp4`（例: `merged_20260131.mp4`）
  - 同名ファイルが存在する場合: `merged_YYYYMMDD-1.mp4`, `merged_YYYYMMDD-2.mp4` と連番

## 対象ファイル

以下の拡張子を対象とする（大文字小文字不問）：

`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

※ 画像ファイルは対象外

## 実行手順

### 1. ファイル収集

カレントディレクトリから対象ファイルを収集し、ファイル名順にソートする。

```bash
ls -1 | grep -iE '\.(mp4|mov|avi|mkv|webm)$' | grep -v '^merged_' | sort
```

※ `merged_*.mp4`（出力ファイル）は対象外

### 2. 各ファイルを中間ファイルに変換

各ファイルを 1920x1080、黒パディング付きの中間ファイルに変換する。

**重要**: すべての中間ファイルで以下を統一すること：
- フレームレート: 30fps
- ピクセルフォーマット: yuv420p
- 映像コーデック: libx264 (プリセット: medium)
- 音声: AAC 48kHz ステレオ（無音でも必ず付与）

音声の有無で分岐して処理：
```bash
# 音声トラックの有無を確認
has_audio=$(ffprobe -i input.mp4 -show_streams -select_streams a 2>/dev/null | grep -c "index")

if [ "$has_audio" -gt 0 ]; then
  # 音声あり
  ffmpeg -fflags +genpts -i input.mp4 \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30" \
    -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
    -c:a aac -ar 48000 -ac 2 -b:a 128k \
    temp_N.mp4
else
  # 音声なし（無音トラックを追加）
  ffmpeg -fflags +genpts -i input.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30" \
    -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
    -c:a aac -ar 48000 -ac 2 -b:a 128k \
    -shortest \
    temp_N.mp4
fi
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
base="merged_$(date +%Y%m%d)"

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
- 対象ファイルが0個の場合はエラーで終了する
- **確認なしで処理を進める**（ファイル一覧は表示するが、確認待ちはしない）
