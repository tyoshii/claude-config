# claude-config

Claude Code のグローバル設定を Git 管理するためのリポジトリ。

## 目的

- `~/.claude` を GitHub で一元管理する
- 複数プロジェクト・複数マシンで共通の skill を利用可能にする
- repo 側の `.claude` による override を前提とした設計

## セットアップ

```bash
# 1. リポジトリを clone
git clone git@github.com:tyoshii/claude-config.git ~/github/tyoshii/claude-config

# 2. セットアップスクリプトを実行
cd ~/github/tyoshii/claude-config
./setup.sh
```

セットアップスクリプトは `~/.claude/skills` にシンボリックリンクを作成する。

```
~/.claude/skills -> ~/github/tyoshii/claude-config/skills
```

**注意**: `~/.claude` ディレクトリ全体を置き換えないこと。Claude Code の履歴やキャッシュが失われる。

## ~/.claude との関係

Claude Code は以下の優先順位で設定を読み込む：

1. **repo/.claude** (最優先)
2. **~/.claude** (グローバル設定 = このリポジトリ)

repo 側に同名の skill が存在すれば、そちらが優先される。

## 想定ユースケース

### /commit を全プロジェクトで使う

```
/commit
```

どのプロジェクトでも一貫したコミット作法を適用できる。プロジェクト固有のルールが必要な場合は、repo 側の `.claude/skills/commit/SKILL.md` で override する。

## ディレクトリ構成

```
claude-config/
├── README.md
├── .gitignore
├── setup.sh          # セットアップスクリプト
├── skills/           # グローバル skill
│   ├── commit/
│   │   └── SKILL.md
│   ├── pr/
│   │   └── SKILL.md
│   └── ...
├── config.yml        # 共通設定
└── docs/
    └── design.md     # 設計思想
```

## 設定ファイル

`config.yml` で共通のデフォルト値を定義する。詳細は [docs/design.md](docs/design.md) を参照。

## License

MIT
