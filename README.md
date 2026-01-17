# claude-config

Claude Code のグローバル設定を Git 管理するためのリポジトリ。

## 目的

- `~/.claude` を GitHub で一元管理する
- 複数プロジェクト・複数マシンで共通の command を利用可能にする
- repo 側の `.claude` による override を前提とした設計

## ~/.claude との関係

このリポジトリの内容は `~/.claude` に配置して使用する。

```bash
# 例: シンボリックリンクで配置
ln -s ~/github/claude-config ~/.claude

# または直接 clone
git clone git@github.com:tyoshii/claude-config.git ~/.claude
```

Claude Code は以下の優先順位で設定を読み込む：

1. **repo/.claude** (最優先)
2. **~/.claude** (グローバル設定 = このリポジトリ)

repo 側に同名の command が存在すれば、そちらが優先される。

## 想定ユースケース

### /commit を全プロジェクトで使う

```
/commit
```

どのプロジェクトでも一貫したコミット作法を適用できる。プロジェクト固有のルールが必要な場合は、repo 側の `.claude/command/commit.md` で override する。

## ディレクトリ構成

```
claude-config/
├── README.md
├── .gitignore
├── command/          # グローバル command
│   └── commit.md
├── config.yml        # 共通設定
└── docs/
    └── design.md     # 設計思想
```

## 将来拡張

現時点の構成は最小限に留めている。以下の拡張を想定：

| フェーズ | 追加要素 | 説明 |
|---------|---------|------|
| 現在 | command/ | Markdown ベースの指示文 |
| 次 | skill/ | 役割ごとに分離した command 群 |
| 将来 | plugin/ | 外部配布可能なパッケージ形式 |

command → skill → plugin の順で段階的に拡張する想定。現時点では command のみ実装し、過度な抽象化は避ける。

## 設定ファイル

`config.yml` で共通のデフォルト値を定義する。詳細は [docs/design.md](docs/design.md) を参照。

## License

MIT
