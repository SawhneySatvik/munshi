// Compile-time gates (checked by `tsc --noEmit`, not by vitest, which strips types). Each line below must fail to
// typecheck; if it ever compiles, its @ts-expect-error is unused and tsc fails.
import type { CommandResult, Session } from '../src/index.ts';

// A Session is made only by core (openSession, signUpSession): a hand-built one is refused.
// @ts-expect-error the brand is not exported
export const forged: Session = { tenantId: '00000000-0000-4000-8000-000000000001', memberId: '00000000-0000-4000-8000-000000000002' };

// A command returns the ids it wrote, never a number: a number to show comes from a snapshot cell.
// @ts-expect-error a number in a command result
export const total: CommandResult = { saleId: '00000000-0000-4000-8000-000000000003', totalMinor: 12_300 };
