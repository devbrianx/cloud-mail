const apiResponse = {
	ok(c, data, status = 200) {
		return c.json({ success: true, data }, status);
	},
	fail(c, status, errorCode, error) {
		return c.json({ success: false, error, errorCode }, status);
	},
	noContent(c) {
		return c.body(null, 204);
	}
};

export default apiResponse;
