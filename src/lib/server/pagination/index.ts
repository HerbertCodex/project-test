export const DEFAULT_PAGE_SIZE = 25;

/**
 * Clamps a raw `page` search-param value to a valid page number.
 * Anything absent, empty, non-numeric, non-integer or below 1 becomes 1.
 * Once `pageCount` is known, the result is also clamped to `pageCount`.
 */
export function parsePageParam(raw: string | null, pageCount?: number): number {
	let page = 1;
	if (raw !== null && raw.trim() !== '') {
		const parsed = Number(raw);
		if (Number.isInteger(parsed) && parsed >= 1) {
			page = parsed;
		}
	}
	if (pageCount !== undefined) {
		page = Math.min(page, pageCount);
	}
	return page;
}

/**
 * Computes the total number of pages for `total` items at `pageSize` per page.
 * Always at least 1, so a page count remains defined even with 0 results.
 */
export function computePageCount(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / pageSize));
}

/** Computes the SQL OFFSET for a given (already clamped) 1-based page number. */
export function computeOffset(page: number, pageSize: number): number {
	return (page - 1) * pageSize;
}
