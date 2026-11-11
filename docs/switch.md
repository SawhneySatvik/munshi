# Munshi in a Switch room

A shop's staff group becomes its back office. Munshi joins the group as a teammate through
[Switch](https://www.switchagents.ai/): the cashier asks it questions, it reports what is leaking, it drafts the fix, and the
books change only when someone allowed to approve says so, in the same chat, under their own name.

Built for the Flip the Switch hackathon. **What is new for it:** `apps/teammate`, `apps/web/lib/server/teammate.ts`,
`apps/web/app/api/internal/teammate`, `apps/web/app/app/chat-link`, `db/schema/27_chat_link.sql`,
`packages/core/src/chat-link.ts` and `chatSession` in `packages/core/src/session.ts`. **What already existed:** Munshi itself,
meaning its agents, its approval flow and its books.

## Why Switch is central

Without Switch this workflow does not exist. Switch provides everything between a person and the agent:

| Switch gives | Munshi uses it for |
|---|---|
| A room bridged to the staff's own Telegram group | The only place this workflow happens |
| A stable id for each person, on any chat app | Telling who is speaking, so their link and role apply |
| `@munshi` addressing | Acting only on messages meant for it |
| Reliable delivery, with resume from a cursor | Not losing a message when the relay restarts |

Switch knows who is speaking. Munshi decides what that person may do. An agent in a chat is only as trustworthy as that
second step, and Munshi's is enforced by the database.

## How it works

```
Telegram group ⇄ Switch server ⇄ WebSocket ⇄ apps/teammate (relay) ⇄ /api/internal/teammate ⇄ Munshi core and agents
```

- **The relay** is a long-running Node process. Switch pings it every two seconds, so it can't be a serverless function. It
  holds no shop logic.
- **The route** answers only the relay's shared secret. The relay vouches for which chat account spoke, and nothing else.
- **Each message runs as the person who sent it**, through the same flows as the app.

### A chat account becomes a member

1. A signed-in member opens **Chat link** in Munshi and gets a one-time code.
2. They post `@munshi link XXXX-XXXX` in the group from their own account.

This is the same link-code pattern Switch uses to tie a chat account to its own users, applied to Munshi's members: the code
shows who asked, and Switch shows which account answered. The code is kept as a hash, works once and lasts thirty minutes. The link lasts fourteen days and ends sooner if the member revokes it,
is deactivated or is erased. An account with no link gets nothing from the books.

### What people can say

| Message | What happens |
|---|---|
| `@munshi <any question>` | Answered from the books; each figure cites its row, or "Cannot verify" |
| `@munshi brief` | What is leaking, largest first |
| `@munshi fix <code>` | Drafts the fix. Nothing changes yet |
| `@munshi drafts` | What is waiting for a decision |
| `@munshi approve <code>` | Runs under this person, if their role may approve it |
| `@munshi reject <code> <reason>` | Reasons: `wrong_figure`, `duplicate`, `not_now`, `not_relevant`, `other` |

### The guarantee in a chat

- **A decision runs as the linked member.** It goes through the same `decide()` as the app. A cashier who types `approve` is
  refused by the database, and the draft keeps waiting. Chat changes nothing about who may approve.
- **Approval is once, for one draft.** There is no "allow for this session".
- **A chat message is a screen.** Figures come from stored cells through the screens' resolver, with their sources. The
  agent's words carry no digits of their own.
- **Sample data is labelled** on every reply from a sample shop.

## Run it

You need a Switch server and a Telegram bot. See Switch's
[quickstart](https://docs.switchagents.ai/switch-rooms/getting-started) and its
[Telegram guide](https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/telegram). Turn the bot's Group Privacy off
before adding it to the group.

1. Create a registration key on the Gateway's **API Keys** page. In `.env`, set `SWITCH_URL` (the Switch server's own address,
   `http://localhost:8000` by default, not the Gateway page) and `SWITCH_REGISTRATION_KEY`.
2. Run `pnpm teammate:register`. It saves the agent's id and key, and a new secret the relay and the web app share, to
   `.env.switch`. Switch shows the key only once, so keep that file.
3. In `.env`, set `SWITCH_ROOM_ID` to the room's id and `MUNSHI_TEAMMATE_SHOP=sharma-general-store`. Invite `munshi` to the room.
4. Run `pnpm dev`, and in a second terminal `pnpm teammate`. Start them in that order, after step 2, so both load the secret.
5. Sign in to the demo shop as the owner, open **Chat link**, and post the code in the group. Do the same as a cashier, from a
   second chat account.

**No API keys needed:** the model is in recorded mode by default, so `brief`, `fix`, `drafts`, `approve` and `reject` all work.
Questions work for the two recorded in English, "How much did the counter take yesterday?" and "Who is most overdue on credit?". Any other question says
"Cannot verify". Set `MUNSHI_MODEL_MODE=live` and a model key to ask anything.

### Try this

```
@munshi brief
@munshi fix <code from the brief>
(as the cashier) @munshi approve <code>     → refused by the database
(as the owner)   @munshi approve <code>     → done, under the owner's name
```

## Limits

- One relay serves one shop and one room.
- Anyone holding the relay's secret can claim to be any chat account, so it must be kept like a password.
- Approval from chat rests on the chat account. Someone holding a member's unlocked phone can approve as them, within that
  member's role. The app's approval stays available.
- Approval is typed. Switch has approval cards in its source, but they aren't documented for custom agents.
- Text only: a photo posted in the group isn't read yet.
