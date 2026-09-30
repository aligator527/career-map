# 自己申告データの受け付けを始める手順（Supabase）

受け付けを始めるには、次の手順を一度だけ行います。所要時間は約10分です。これが済むまでは、サイトの提供フォームは「準備中」と表示され、集計ワークフローも何もしません。

## 1. Supabase のプロジェクトを作る
1. https://supabase.com でアカウントを作り、**New project** を選ぶ（Free プランで十分）。
2. Region はユーザーに近い場所（例: Northeast Asia (Tokyo)）を選ぶ。データベースのパスワードは保存しておく（このサイトでは使わない）。

## 2. テーブルとアクセス制御を作る
1. ダッシュボードの **SQL Editor** を開く。
2. [`supabase/migrations/001_submissions.sql`](../supabase/migrations/001_submissions.sql) の中身を貼り付けて **Run** を押す。

このマイグレーションは次のことを行います。
- 表 `submissions` を作る。
- 公開キーからは追加のみ許可する（行単位のアクセス制御）。
- 送信の頻度を制限する。
- 削除用の関数 `delete_submission` を作る。

## 3. キーを確認する
**Project Settings → API** で次の 3 つを確認します。

| 名前 | 用途 | 扱い |
|---|---|---|
| Project URL（`https://xxxx.supabase.co`） | サイトと集計 | 公開してよい |
| `anon` `public` キー | サイト（追加と削除関数のみ） | 公開してよい（サイトの JavaScript に埋め込まれる） |
| `service_role` キー | 夜間の集計（全件を読む） | **秘密**。GitHub Secrets にだけ入れる |

## 4. GitHub に設定する
リポジトリの **Settings → Secrets and variables → Actions** で設定します。

- **Variables** タブ:
  - `SUPABASE_URL` = Project URL
  - `SUPABASE_ANON_KEY` = anon キー
- **Secrets** タブ:
  - `SUPABASE_SERVICE_ROLE_KEY` = service_role キー

コマンドで設定する場合は次のとおりです（`gh` にログイン済みのこと）。

```bash
gh variable set SUPABASE_URL --body "https://xxxx.supabase.co"
gh variable set SUPABASE_ANON_KEY --body "<anon key>"
gh secret set SUPABASE_SERVICE_ROLE_KEY
```

## 5. サイトを作り直す
**Actions → Deploy to GitHub Pages → Run workflow** を実行します。これでフォームが有効になります。

集計は **Update community data**（毎日 03:17 JST）で自動的に行われます。すぐ試すときは手動で実行してください。

## 補足
- **無料プランの休止**: Supabase の無料プランは、1週間アクセスがないとプロジェクトが休止します。毎晩の集計がアクセスになるため、通常は休止しません。
- **ローカルで試す**: `web/.env.local` に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を書いて `npm run dev` を実行します（`.env.local` はコミットしない）。
- **いたずら対策**: 送信の頻度制限は、全体で 1分20件・1日2,000件です。
  - いたずらが多い場合は、次のどれかを追加します。
    - Cloudflare Turnstile（無料の CAPTCHA）
    - Supabase Edge Function による検証
  - 集計時の外れ値除外も有効です。
