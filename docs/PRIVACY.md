# プライバシーについて / Privacy

## 日本語

キャリアマップは、公的統計に加えて、利用者が**任意・匿名**で提供する年収データ（自己申告）を集計して表示します。

### 画面での利用（申告しない場合）
- 入力した条件（国・地域・職業・年齢・性別・学歴・年収）は**ブラウザの外に送信されません**。計算はすべてお使いのブラウザ内で行います。
- 「この端末に入力を保存する」を選んだ場合だけ、入力をお使いのブラウザ（localStorage）に保存します。
- アクセス解析ツールや広告は使っていません。

### 申告した場合に保存するもの
「あなたのデータを匿名で提供する」から送信した場合に限り、次の項目を保存します。送信前に画面に全項目を表示します。

| 項目 | 保存する形 |
|---|---|
| 国・地域・職業 | 選んだコード |
| 年齢 | 5歳刻みの年齢階級（18〜24歳はまとめる） |
| 性別・学歴 | 選んだ場合のみ |
| 年収 | 10万円（日本）／1,000単位（ほかの通貨）に丸めた値 |
| 働き方・役職レベル・英語力・リモートワーク・過去3年の転職 | 選んだ場合のみ |
| 送信日 | 日付のみ（時刻は保存しない） |
| 削除用コードのハッシュ | 削除用コードの SHA-256 値（コード自体は保存しない） |

- **保存しないもの**: 名前、メールアドレス、IPアドレス、端末情報、自由記述。
- 送信の頻度制限のために、送信時刻だけを申告とは別の表に記録し、1日以内に消去します。この記録は申告とは結び付きません。

### 保存場所と見られる人
- データは Supabase（PostgreSQL）に保存します。
- ウェブサイトに埋め込まれている公開キーでは、**新規追加しかできません**。読み取り・変更はできません（行単位のアクセス制御）。
- 個々の申告を読めるのは、集計処理（GitHub Actions、1日1回）と運営者のみです。

### 公開する範囲
- 公開するのは集計結果だけです。個々の申告は公開しません。
- 同じ組み合わせの申告が **10件以上**のグループについてのみ、次を公開します。
  - 四分位（25%・中央値・75%）。年収の丸め単位でさらに丸めます。
  - 件数。**5件単位に切り下げ**て公開します。
- 最小値・最大値は公開しません。

### 残るリスク
次の対策を重ねていますが、リスクを完全になくすことはできません。
- 件数の丸め。
- 四分位の丸め。
- 10件未満のグループを公開しないこと。

**残るリスクの例**: 特殊な条件（例: 小さな地域の珍しい職業）で申告すると、日ごとの集計結果の変化から、その人がいることが推測される可能性があります。心配な場合は、地域や職業を「指定しない」にして申告してください。

### 削除
- 送信後に表示される**削除用コード**を入力すると、その申告を削除できます。
- 削除は次回の集計（1日1回）から反映されます。
- コードは再発行できません。運営者もコードを知りません。

### 統計としての注意
自己申告のデータは代表的な標本ではありません。このようなサービスに関心がある人に偏るため、公的統計と並べて参考程度にご覧ください。

### 問い合わせ
GitHub の Issues（https://github.com/aligator527/career-map/issues ）からご連絡ください。個人を特定できる情報は書かないでください。

---

## English

Career Map shows official statistics plus pay data that users **voluntarily and anonymously** report.

**Using the site without submitting**
- Your inputs never leave your browser; all calculations run locally.
- Inputs are stored in your browser's localStorage only if you choose "Remember my inputs".
- There are no analytics or ads.

**What is stored when you submit**
- The following fields, all shown to you before sending:
  - country, region, occupation
  - a 5-year age band
  - sex and education (only if given)
  - pay rounded to ¥100,000 or 1,000 units of other currencies
  - type of work, role level, English level, remote work and recent job change (only if given)
  - the date (no time)
  - a SHA-256 hash of your deletion code
- **Never stored:** name, email, IP address, device data or free text.
- Submission times are logged separately for rate limiting, are not linked to submissions, and are erased within a day.

**Who can see it**
- The data lives in Supabase (PostgreSQL).
- The public key embedded in the site can **only insert** rows. It cannot read or change them (row-level security).
- Only the nightly aggregation job (GitHub Actions) and the maintainer can read individual rows.

**What is published**
- Only aggregates for groups with **10 or more** reports:
  - quartiles (25%, median, 75%), rounded to the pay unit
  - the count, rounded down to a multiple of 5
- No minimum or maximum values are published.

**Remaining risk:** if you submit with a very unusual combination (e.g. a rare occupation in a small region), day-to-day changes in the aggregates could reveal that someone with that profile submitted. To avoid this, leave the region or occupation unspecified.

**Deletion:** enter the deletion code shown after submitting. The deletion takes effect in the next daily aggregation. Codes cannot be reissued; the maintainer does not know them.

**Caveat:** self-reported data is not a representative sample.

**Contact:** GitHub Issues (https://github.com/aligator527/career-map/issues). Please do not include personal information.
