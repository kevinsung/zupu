// One place that turns anything thrown into text. Messages stay as [中文, English] pairs until the
// last step, so a prefix can be added to each language before they're joined (see prefixed).
import { type Pair, both, pair, prefixed } from './i18n'

/**
 * An expected refusal or validation error, worded for the person using the app. It isn't a
 * failure, so it never gets a "Save failed" prefix. `field` names the input at fault, so the
 * dialog can mark and focus it.
 */
export class UserError extends Error {
  constructor(public pair: Pair, public field?: HTMLElement) { super(both(pair)) }
}

/** The Worker answered with an error status; `message` is its raw (English) detail. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** `fetch` itself rejected: offline, or the server couldn't be reached. */
export class NetworkError extends Error {}

/** Adds the Worker's raw detail to each side, so a bug report still has something to quote. */
function withDetail([zh, en]: Pair, detail: string): Pair {
  return detail ? [`${zh}（${detail}）`, `${en} (${detail})`] : [zh, en]
}

/**
 * The only formatter for errors shown to people. `failed` (e.g. 儲存失敗 / Save failed) goes in
 * front of anything that is a real failure: all but a UserError.
 */
export function errorText(e: unknown, failed?: Pair): string {
  if (e instanceof UserError) return both(e.pair)
  const body: Pair =
    e instanceof NetworkError ? pair('couldntConnect')
    : e instanceof ApiError ? (e.status === 409 ? pair('personGone')
      : withDetail(pair(e.status === 400 ? 'serverRefused' : 'serverError'), e.message))
    : [(e as Error)?.message ?? String(e), (e as Error)?.message ?? String(e)]
  return both(failed ? prefixed(failed, body) : body)
}
