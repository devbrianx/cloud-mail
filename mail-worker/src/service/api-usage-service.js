import orm from '../entity/orm';

function utcDate(offset = 0) {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offset);
	return date.toISOString().slice(0, 10);
}

const apiUsageService = {
	async recordSuccess(c, apiKeyId) {
		await c.env.db.prepare(`
			INSERT INTO api_key_usage(api_key_id, usage_date, call_count) VALUES (?, ?, 1)
			ON CONFLICT(api_key_id, usage_date) DO UPDATE SET call_count = call_count + 1
		`).bind(apiKeyId, utcDate()).run();
	},

	async usageByKey(c, apiKeyIds) {
		if (!apiKeyIds.length) return new Map();
		const placeholders = apiKeyIds.map(() => '?').join(',');
		const rows = await c.env.db.prepare(`
			SELECT api_key_id, SUM(CASE WHEN usage_date = ? THEN call_count ELSE 0 END) AS today_calls,
			       SUM(CASE WHEN usage_date >= ? THEN call_count ELSE 0 END) AS last_30_days_calls
			FROM api_key_usage WHERE api_key_id IN (${placeholders}) GROUP BY api_key_id
		`).bind(utcDate(), utcDate(-29), ...apiKeyIds).all();
		return new Map(rows.results.map(row => [row.api_key_id, { todayCalls: Number(row.today_calls), last30DaysCalls: Number(row.last_30_days_calls) }]));
	},

	async cleanup(c) {
		await c.env.db.prepare(`DELETE FROM api_key_usage WHERE usage_date < ?`).bind(utcDate(-29)).run();
	}
};

export default apiUsageService;
