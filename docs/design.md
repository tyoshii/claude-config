# 設計思想

このドキュメントは claude-config の設計判断とその背景を記録する。

## なぜ ~/.claude を Git 管理するのか

### 問題

Claude Code を複数プロジェクトで使うと、同じ skill を各リポジトリの `.claude/` にコピーすることになる。マシンが増えると同期の手間も増える。

### 解決

`~/.claude` をリポジトリ化することで：

- 一箇所で管理、どこでも利用
- 変更履歴が残る
- 複数マシン間で `git pull` するだけで同期

dotfiles を Git 管理するのと同じ発想。

## なぜ skill を Markdown で持つのか

### 選択肢

1. **シェルスクリプト** - 実行可能だが、Claude Code の文脈では不自然
2. **JSON / YAML** - 構造化しやすいが、人間が書くには冗長
3. **Markdown** - 自然言語で記述でき、Claude Code が直接解釈できる

### 判断

Markdown を採用した理由：

- Claude Code は Markdown を自然に解釈する
- 人間が読み書きしやすい
- コードブロックで構造化もできる
- Claude Code 公式の skill フォーマット（SKILL.md）と互換

skill は「Claude Code への指示文」であり、プログラムではない。自然言語で書くのが最も適切。

## override 設計

### 優先順位

```
repo/.claude > ~/.claude
```

repo 側に同名の設定・skill があれば、そちらが優先される。

### 設計意図

- グローバル設定は「デフォルト」であり「強制」ではない
- プロジェクト固有の要件は repo 側で対応
- グローバル設定を変更しても、既存プロジェクトの挙動は壊れない

### 例

```
~/.claude/skills/commit/SKILL.md       # デフォルトの commit 作法
repo/.claude/skills/commit/SKILL.md    # このプロジェクト専用の commit 作法
```

repo 側に `commit` skill があれば、グローバルの `commit` skill は無視される。

## plugin install 方式との違い

### plugin install 方式

```bash
claude plugin install some-plugin
```

- 中央レジストリからインストール
- バージョン管理は plugin 単位
- 設定は別ファイルで管理

### 本リポジトリの方式

```bash
git clone ... && ./setup.sh
```

- 自分のリポジトリで完全に管理
- 必要なものだけを持つ
- 設定と skill が同じ場所にある

### 思想的な違い

| 観点 | plugin install | 本リポジトリ |
|-----|---------------|-------------|
| 管理主体 | 外部の plugin 作者 | 自分 |
| カスタマイズ | 設定ファイルで調整 | 直接編集 |
| 更新 | plugin update | git pull + 手動マージ |
| 依存関係 | 複雑になりがち | 自分で管理 |

本リポジトリは「自分の作法を持ち歩く」ことを重視している。外部依存を最小化し、理解できる範囲に留める。

## まとめ

このリポジトリは「Claude Code を自分好みに育てる」ための土台。

過度な抽象化や汎用化は避け、実際に使いながら必要なものを足していく。設定や skill は全て自分で理解・編集できる状態を維持する。

plugin エコシステムが成熟したら、そちらに移行する選択肢もある。しかし現時点では、自分で管理できるシンプルな構成が最も実用的と判断した。
