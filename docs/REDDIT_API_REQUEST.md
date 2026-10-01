# Reddit Data API: access request

Since November 2025, Reddit no longer issues API keys on its own. Every new app needs manual approval under the Responsible Builder Policy. The steps below cover the request through to the first data collection.

## 1. Submit the request

1. Sign in to Reddit with the account the app will belong to. Use an account with some history: brand-new accounts get rejected more often.
2. Open the Developer Support form: https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164
3. Fill in the form with the text below, adjusting it if needed. The form is in English.

> **Use case summary**
> Career Map (https://aligator527.github.io/career-map/, source: https://github.com/aligator527/career-map) is a free, non-commercial personal project. It shows people where they stand on pay and careers using official statistics (Japan, US, UK, Canada, Germany, France, Italy, Netherlands, Australia, Singapore, Korea). We would like to add a small "what people report" section: a few dozen short claims about work visas, job searches and rent that several independent Reddit users make in several threads. Each claim is shown next to the official statistics it can be checked against.
>
> **How we use the data**
> - Read-only, app-only OAuth (client credentials). No posting, voting, messaging or any write actions.
> - Low volume: a few hundred search and comment-listing requests per month, run by hand, well under the free rate limit.
> - Subreddits: about 20 career and immigration communities (e.g. r/movingtojapan, r/ukvisa, r/h1b, r/cscareerquestionsEU, r/IWantOut).
> - Usernames are replaced by a one-way hash the moment a response arrives and are never stored or published. The hash is used only to count distinct people.
> - We publish only our own short paraphrase of each claim, the number of users and threads that support it, and links back to the original reddit.com threads. We do not republish post or comment text.
> - Content deleted on Reddit is dropped when we refresh the data, and the published claims are rebuilt from the refreshed data.
> - No AI/ML model training, no sale or sharing of data, no advertising, no commercial use.
>
> **Contact**: the account submitting this request.

4. Wait for an answer, which may take several weeks. Rejections usually come without a reason. If yours is rejected, you can apply again with more detail.

## 2. After approval

1. Create an app of type **script** at https://www.reddit.com/prefs/apps (redirect URI: `http://localhost:8080`).
2. Copy `pipeline/.env.reddit.example` to `pipeline/.env.reddit` and fill in the values:
   - `REDDIT_CLIENT_ID`: the string under the app name;
   - `REDDIT_CLIENT_SECRET`: the "secret";
   - `REDDIT_USERNAME`: the account that owns the app.

   The file is in `.gitignore`. Do not paste the keys into chats, issues or commits.
3. Collect the data:

```bash
cd pipeline && uv run python -m career_pipeline.reddit_collect
```

4. Claims are written from the summaries in `data/raw/reddit/digest/` and saved in `labels/insights_*.json`.
5. Rebuild the insights. `insights.py` checks every source against the collected data:

```bash
uv run python -m career_pipeline insights
```

6. To publish, set `publish: true` in `labels/insights_config.json` and rebuild.
