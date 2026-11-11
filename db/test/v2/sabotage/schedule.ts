// Red-proofs of the calendar's schedule view (apps/web/test/schedule.test.tsx on Elite's books, and
// schedule-board.test.tsx with Bryntum stubbed): the board is read from the stored booking rows; a move lands only on a
// slot core offers, only for a confirmed booking, and cancels the booking it replaces; Bryntum loads only in the
// browser; and a drop edits nothing until the person confirms it. Each breaks one and names the test that must then fail.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const DB = 'test/schedule.test.tsx';
const BOARD = 'test/schedule-board.test.tsx';
const READ = 'day 1: a row per stylist at each branch and every live booking that day, as the rows store them; no digit without a source';
const MOVE = 'a move to a slot core offers: the new slot booked for the same customer, the old one cancelled, both as the signed-in manager';
const NOT_OFFERED = 'a drop where core offers no slot is refused, and nothing is written';
const REQUEST = 'a request does not move from the board (it is confirmed or declined), and nothing is written';
const CANCEL =
  'a confirmed booking is cancelled from the board by a manager, under their name; a member who does not handle bookings changes nothing';
const CLIENT_ONLY = 'one client file imports Bryntum, and only next/dynamic with SSR off reaches it';
const EDITS_NOTHING = "the board edits nothing: every editing feature off, and a drop undone in Bryntum's store and reported";
const PROPOSAL = 'a drop on the page is a proposal: a read checks it, a ghost shows beside the faded original, and only Confirm sends the move';
const SERVER = 'apps/web/lib/server/schedule.ts';
const VIEW = 'apps/web/components/schedule/ScheduleView.tsx';
const BRYNTUM = 'apps/web/components/schedule/BryntumBoard.tsx';

export const SCHEDULE_CASES: Case[] = [
  // A bar ends where it starts: the board no longer shows the stored row's span.
  { sabotage: 'web-schedule-span', file: DB, test: READ, ...WEB, ts: { file: SERVER, from: 'endsAt: b.endsAt,', to: 'endsAt: b.startsAt,' } },
  // Any free slot of the stylist will do: a drop off the roster books another time.
  {
    sabotage: 'web-schedule-any-slot',
    file: DB,
    test: NOT_OFFERED,
    ...WEB,
    ts: { file: SERVER, from: 'o.staffId === ask.staffId && o.start.getTime() === at', to: 'o.staffId === ask.staffId' },
  },
  // A request moves like a confirmed booking, skipping booking.confirm.
  {
    sabotage: 'web-schedule-request-moves',
    file: DB,
    test: REQUEST,
    ...WEB,
    ts: { file: SERVER, from: 'if (booking?.state !== "confirmed") return "not_movable";', to: 'if (!booking) return "not_movable";' },
  },
  // The move books the new slot and leaves the old booking standing.
  {
    sabotage: 'web-schedule-old-kept',
    file: DB,
    test: MOVE,
    ...WEB,
    ts: {
      file: 'apps/web/app/app/calendar/actions.ts',
      from: 'await moveBooking(pool, session, { bookingId: target.bookingId, state: "cancelled" });',
      to: 'void moveBooking;',
    },
  },
  // Cancelling from the board marks the booking a no-show instead.
  {
    sabotage: 'web-schedule-cancel-wrong',
    file: DB,
    test: CANCEL,
    ...WEB,
    ts: {
      file: 'apps/web/app/app/calendar/actions.ts',
      from: 'await moveBooking(await appPool(), session, { bookingId, state: "cancelled" });',
      to: 'await moveBooking(await appPool(), session, { bookingId, state: "no_show" });',
    },
  },
  // The board is server-rendered: Bryntum is loaded on the server. The scan reads source text, so the test plants the
  // changed text itself (harness-level).
  { sabotage: 'web-schedule-ssr', file: BOARD, test: CLIENT_ONLY, ...WEB },
  // A server module imports Bryntum.
  { sabotage: 'web-schedule-server-import', file: BOARD, test: CLIENT_ONLY, ...WEB },
  // A drop is kept in Bryntum's store: the bar sits at its new time as if saved.
  { sabotage: 'web-schedule-drop-kept', file: BOARD, test: EDITS_NOTHING, ...WEB, ts: { file: BRYNTUM, from: 'context.finalize(false);', to: 'context.finalize(true);' } },
  // Bryntum's event editor is on: a person edits a bar the books never see.
  { sabotage: 'web-schedule-editor-on', file: BOARD, test: EDITS_NOTHING, ...WEB, ts: { file: BRYNTUM, from: 'eventEditFeature={false}', to: 'eventEditFeature' } },
  // A drop sends the move at once, with no confirmation.
  {
    sabotage: 'web-schedule-drop-sends',
    file: BOARD,
    test: PROPOSAL,
    ...WEB,
    ts: { file: VIEW, from: 'startTransition(() => check(form));', to: 'startTransition(() => move(form));' },
  },
];
