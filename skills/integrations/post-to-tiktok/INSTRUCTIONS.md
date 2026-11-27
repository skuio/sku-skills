Use this skill to post a product video, or a set of product photos, to a store's TikTok account
through SKU.io's **TikTok Posting**. SKU.io holds each store's TikTok connection, checks the video,
and sends the post. You never handle TikTok tokens and never call TikTok directly.

What you produce: a post in SKU.io that a person approves, then SKU.io publishes it to the TikTok
profile (`mode: direct`) or sends it to the account's TikTok drafts to finish in the app
(`mode: inbox`). You then follow the post until it is published, waiting on a person, or failed
with a reason.

**Which connection.** Posting needs a Personal Access Token with `tiktok-posts:write` (plus
`tiktok-posts:read`, and `products:read` to find a product's videos). Through the hosted SKU.io
MCP server you can read accounts, videos and posts, but it doesn't create TikTok posts. To post
from an MCP chat, hand the user the SKU.io link (**PIM → TikTok Posting → New post**) instead.

## The approval rule

**Nothing you create with an API token reaches TikTok until a person approves it in SKU.io.**
A post created with a token lands in `needs_approval`. Tokens can never approve. Approve and
Reject only work for a signed-in person with the TikTok Posting approve permission. That person
clicks the green check on the post in **PIM → TikTok Posting** (the **Needs approval** filter), or
uses the link in SKU.io's approval email.

The only exception is a store setting, **Allow API posts to skip approval**, which an approver can
switch on per store. Leave it alone: never ask anyone to switch it on so you can post unattended.
If a user wants hands-off posting, tell them it is their call to make in Settings, and what it
means: posts from scripts would then go to TikTok with nobody checking them.

So `needs_approval` is a normal, successful outcome for you. Report it as "waiting for approval
in SKU.io", with the post id, and stop polling.

## Step 1 — Pick the account

Call **list-tiktok-accounts**. Each row is a store, with its TikTok `account` or `null`.

- **One store, or the user named one** → use that row's `account.id`. That id, not the store id,
  is what `account_id` takes.
- **Several stores and none named** → ask which store (or TikTok username) to post to. Never
  guess: each store posts to a different brand's profile.
- **`account` is null** → the store has no TikTok account connected. A person connects it in
  SKU.io: **PIM → TikTok Posting → Accounts → Connect TikTok**, which needs a TikTok sign-in. You
  cannot do that step. Stop and say so.
- **`account.health.state` is `reconnect_needed`** → a person must reconnect it on the same
  screen. Posts fail until then.

Check the account can post the way you intend: `can_direct_post` (scope `video.publish`) for
`mode: direct`, `can_upload_to_inbox` (scope `video.upload`) for `mode: inbox`.

**Daily limits.** TikTok allows about 15 direct posts per account per day (`usage.direct_posts_24h`)
and at most 5 videos waiting in the drafts inbox (`usage.pending_inbox_24h`). Near either limit,
schedule the post for tomorrow instead of failing it.

## Step 2 — Read the account's posting options

Call **get-tiktok-creator-info** with the account id, right before you create the post. TikTok
answers live, and it is the only source for:

- `privacy_level_options`: the only values `privacy_level` may take. **There is no default.**
  Use the value the user asked for. If they didn't say, ask, or use the default their own
  process names (a heartbeat's config, for example). Never pick one yourself.
- `comment_disabled`, `duet_disabled`, `stitch_disabled`: a setting the creator turned off stays
  off, whatever you send.
- `max_video_post_duration_sec`: a longer video is refused.
- `can_post: false`, or `data: null` with an `error` → don't create the post. Report
  `error.message` and `error.category` (`reconnect`, `wait`, `edit`, `blocked` or `retry`).

`app.audited: false` means SKU.io's TikTok app is still under TikTok's review: posts can then only
be private (`SELF_ONLY`) and the account itself must be private.

## Step 3 — Get the media

### A video

**Already in SKU.io?** Resolve the product with **find-product**, then **list-product-videos**.
Use a video with `status: ready`. Check its `tiktok_fit`:

- `ready` → vertical, a codec and frame rate TikTok accepts: post it.
- `letterboxed` → TikTok accepts it, but it isn't vertical and shows with bars. Offer
  **optimize-video**, which makes a TikTok-ready vertical copy as a new video.
- `unsupported` → TikTok will refuse it (`tiktok_fit_reason` says why). Run **optimize-video**,
  or ask for a new export: vertical 9:16, 1080×1920, H.264, 23–60 fps, up to 10 minutes.

**A file you have?** Upload it with the product's id, so it also shows on the product:

- **Up to 20 MB:** **upload-video**, one `multipart/form-data` request.

  ```bash
  curl -sS -X POST "https://$SKU_TENANT.sku.io/api/videos" \
    -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" \
    -F "file=@kit-install-1080x1920.mp4" -F "product_id=512"
  ```

- **Larger than 20 MB (up to 1 GB):** a multipart upload.
  1. **start-video-upload** with `filename`, `size` (bytes) and `mime`. Keep `video_id`,
     `part_size` and `part_urls`.
  2. Cut the file into `part_size`-byte parts (part n = bytes `(n-1)*part_size` up to
     `n*part_size`; the last part holds the rest). PUT each part's raw bytes to its URL **with no
     Authorization header**: the URL is presigned, and sending your token to the storage host
     leaks it. Parts can go in parallel and be retried one by one.
  3. **complete-video-upload**. A `422` lists the missing part numbers: PUT those and complete
     again. If the URLs expired (12 hours), fetch fresh ones with **get-video-upload-urls**.

If the one-request upload comes back `422` with "The file failed to upload", or `413`, the
server refused the request body before SKU.io could read it. Upload the same file with the
multipart flow instead: its parts go straight to storage.

Either way, poll **get-video** every few seconds until `status` is `ready` (then check
`tiktok_fit` as above) or `failed` (report `failure_reason`).

### Photos instead

Call **list-product-photos** with the product's `sku` or `product_id`. If
`photo_posts_available` is false, photo posts aren't switched on yet: post a video. Otherwise send
`media_type: photo`, up to 35 `photo_image_ids` in the order viewers swipe them, and optionally
`photo_cover_index` and a `title`. TikTok fetches the photos from SKU.io itself.

## Step 4 — Write the caption

Use the user's caption if they gave one. Otherwise **suggest-tiktok-caption** drafts one from the
product's data and the store's caption template and hashtags. It saves nothing. Show the user the
draft before you post it, and never post a caption claiming something the product data doesn't
say.

Limits: 2,200 characters for a video and 4,000 for a photo post, counted in UTF-16 units (an
emoji counts as 2). Hashtags go inside the caption.

## Step 5 — Create the post

**create-tiktok-post** with an **`Idempotency-Key` header** (required with a token). Make the key
stable for the post you mean: your own item id plus `tiktok` works. Repeating the call with the
same key returns the post already made (`200`) instead of a second one (`201`). Retry a timeout
with the same key and you will never double-post.

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/tiktok-posting/posts" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -H "Idempotency-Key: kit-512-2026-11-27+tiktok" \
  -d '{
    "account_id": 12,
    "video_id": 88,
    "product_id": 512,
    "caption": "Bolt-on vertical doors, no cutting. #lambodoors #carmods",
    "mode": "direct",
    "privacy_level": "PUBLIC_TO_EVERYONE",
    "allow_comment": true,
    "disclose": true,
    "brand_organic": true,
    "publish": "submit"
  }'
```

Choosing the fields:

| You want | Send |
| --- | --- |
| Post to the profile | `mode: direct` and a `privacy_level` from creator-info |
| Let a person add music or effects in the TikTok app | `mode: inbox` and **no** `privacy_level` (it's refused; TikTok asks in the app) |
| Go out as soon as it's approved | `publish: submit` |
| Go out at a set time | `publish: schedule` and `scheduled_at` (ISO-8601 UTC, 5 minutes to 60 days ahead) |
| Keep it in SKU.io for a person to finish | `publish: draft` |
| A post promoting the store's own product | `disclose: true` and `brand_organic: true` (TikTok labels it Promotional content) |
| Hold the post while the product is out of stock | `stock_gate_min_units: N`, re-checked when it publishes |

Interactions (`allow_comment`, `allow_duet`, `allow_stitch`) default to **off**. Turn on only
what the user wants. `brand_content` (a paid partnership) can't be combined with `SELF_ONLY`.

A `201` (or a `200` replay) returns the post. Report its `id` and status. It is usually
`needs_approval`, and a person approves it in SKU.io.

## Step 6 — Follow the post

Read **get-tiktok-post** every 30–60 seconds while the status is moving, and stop at the first
state that waits on someone else:

| `status` | What it means | Your next step |
| --- | --- | --- |
| `needs_approval` | Waiting for a person in SKU.io | Stop. Report "waiting for approval", with the post id |
| `draft` | Kept in SKU.io, not submitted | Stop |
| `scheduled` | Approved, waiting for its time | Stop. Report `scheduled_at` |
| `queued`, `uploading`, `processing` | SKU.io is sending it and TikTok is processing | Keep polling. TikTok can take a few minutes |
| `published` | Live on the profile | Report `tiktok_url` |
| `sent_to_inbox` | In the account's TikTok drafts | Report that a person posts it from the TikTok app |
| `deleted_in_tiktok` | A person deleted that draft in the TikTok app; it never posted | Stop. Never re-create it unless asked |
| `failed` | Didn't post | See below |
| `needs_review` | TikTok may have received it, but SKU.io lost the answer | Stop. Never retry. A person checks the account in TikTok and settles it in SKU.io |
| `rejected`, `cancelled` | A person said no, or it was cancelled | Stop. Never re-create it |

Don't poll forever: after about 10 minutes in `processing`, report it as pending and check again
later. SKU.io keeps following it either way.

## When a post fails

The post carries `error_code`, a plain `error_message` and `retryable`. Act on `retryable`:

- **`retryable: true`**: call **retry-tiktok-post** once the cause has passed. If the post hasn't
  changed since it was approved it goes straight back to the queue; otherwise it waits for
  approval again. Some causes need a person first:
  - `reconnect_needed`, `access_token_invalid`, `scope_missing` and other sign-in errors → a
    person reconnects the account in SKU.io (**Accounts** tab), then retry.
  - `spam_risk_too_many_pending_share` (drafts inbox full, 5 waiting) → a person posts or deletes
    drafts in the TikTok app, then retry.
  - `upload_url_expired`, `photo_pull_failed`, `rate_limit_exceeded`, `reached_active_user_cap` →
    retry later.
- **`retryable: false`**: don't retry the same post.
  - `video_too_long`, `video_not_ready`, `invalid_param`, `privacy_level_option_mismatch`, or a
    failed video check (`file_format_check_failed`, `duration_check_failed`,
    `frame_rate_check_failed`, `picture_size_check_failed`) → fix it (another or an optimized
    video, a privacy option creator-info offers), **update-tiktok-post**, and it goes back for
    approval.
  - `spam_risk_too_many_posts` → the account hit TikTok's daily limit. Post again tomorrow.
  - `account_not_connected` → a person connects the store's account in SKU.io.
  - `processing_timeout`, `outcome_unknown`, `publish_cancelled` → the post may have gone out.
    Never post it again blindly. A person checks the TikTok account first.

Show `error_message` as it is: it is already written for a person.

## Editing, rescheduling and cancelling

- **update-tiktok-post** edits a post in `draft`, `needs_approval`, `scheduled` or `failed`. Send
  only the fields that change. Any edit clears the approval, except moving only `scheduled_at` of
  a scheduled post. `409` means it can no longer be edited (it's already sending or done).
- **cancel-tiktok-post** cancels a post that hasn't started uploading. A published TikTok video can
  only be deleted in the TikTok app.
- **mark-tiktok-post-deleted-in-tiktok** is for a `sent_to_inbox` post whose draft a person deleted
  in the TikTok app. TikTok can't delete a draft for an app or tell SKU.io one was deleted, so this
  only updates SKU.io's record (to `deleted_in_tiktok`, archived). Call it only after the person
  says they deleted it; `409` for any other status.

## Results

**get-tiktok-post-metrics** returns a published post's views, likes, comments and shares, captured
once a day. If `stats_enabled` is false, the account hasn't granted video stats: a person
reconnects it in SKU.io to turn them on.

## Guardrails

- **Never invent ids.** `account_id`, `video_id`, `product_id` and `photo_image_ids` all come
  from the calls above.
- **One post per intention.** Always send an `Idempotency-Key`, and reuse it on retries.
- **Privacy is a person's choice.** No default, and never wider than the user asked.
- **Don't route around approval.** You can't approve, and you don't ask anyone to switch off
  approval so you can post.
- **Respect TikTok's limits.** About 15 direct posts a day per account, and 5 waiting in drafts.
  Space posts out rather than burst them.
- **Only real claims in captions.** Write from the product data or what the user gave you.

## Not covered here

Shoppable videos (a TikTok Shop product link on the video) use extra fields on the same endpoint
and a connected TikTok Shop official account. This skill doesn't cover them. Do them in the
SKU.io app.
