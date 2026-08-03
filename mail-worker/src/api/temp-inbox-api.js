import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import apiKeyService from '../service/api-key-service';
import apiUsageService from '../service/api-usage-service';
import tempInboxService from '../service/temp-inbox-service';
import tempMessageService from '../service/temp-message-service';

async function requireEnabledUser(c) {
	await apiKeyService.requireEnabled(c);
	return userContext.getUserId(c);
}

app.get('/tempInbox/list', async c => {
	const userId = await requireEnabledUser(c);
	return c.json(result.ok(await tempInboxService.listActiveByUser(c, userId, c.req.query())));
});

app.post('/tempInbox', async c => {
	const userId = await requireEnabledUser(c);
	let body;
	try {
		body = await c.req.json();
	} catch {
		body = {};
	}
	const setting = await apiKeyService.requireEnabled(c);
	const inbox = await tempInboxService.createForUser(c, userId, body.apiKeyId, body, setting);
	await apiUsageService.recordSuccess(c, inbox.apiKeyId);
	return c.json(result.ok(tempInboxService.toApiInbox(inbox)), 201);
});

app.get('/tempInbox/:inboxId/messages', async c => {
	const userId = await requireEnabledUser(c);
	const inbox = await tempInboxService.requireActiveOwnedByUser(c, userId, c.req.param('inboxId'));
	return c.json(result.ok(await tempMessageService.list(c, inbox, c.req.query())));
});

app.get('/tempInbox/:inboxId/messages/:messageId', async c => {
	const userId = await requireEnabledUser(c);
	const inbox = await tempInboxService.requireActiveOwnedByUser(c, userId, c.req.param('inboxId'));
	const row = await tempMessageService.requireMessage(c, inbox, Number(c.req.param('messageId')));
	return c.json(result.ok(await tempMessageService.detail(c, row)));
});

app.delete('/tempInbox', async c => {
	const userId = await requireEnabledUser(c);
	let body;
	try {
		body = await c.req.json();
	} catch {
		body = {};
	}
	return c.json(result.ok(await tempInboxService.deleteActiveOwnedByUser(c, userId, body.inboxIds)));
});
