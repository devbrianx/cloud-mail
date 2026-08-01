import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import apiKeyService from '../service/api-key-service';

app.get('/apiKey/list', async c => {
	const data = await apiKeyService.list(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/apiKey/create', async c => {
	const data = await apiKeyService.create(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok(data));
});

app.delete('/apiKey/:apiKeyId', async c => {
	const apiKeyId = Number(c.req.param('apiKeyId'));
	if (!Number.isInteger(apiKeyId) || apiKeyId < 1) {
		return c.json(result.fail('API key id is invalid', 400));
	}
	await apiKeyService.delete(c, userContext.getUserId(c), apiKeyId);
	return c.json(result.ok());
});
