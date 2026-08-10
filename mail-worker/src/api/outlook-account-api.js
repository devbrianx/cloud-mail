import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import outlookAccountService from '../service/outlook-account-service';

app.get('/outlookAccount/list', async c => c.json(result.ok(await outlookAccountService.list(c, userContext.getUserId(c), c.req.query()))));
app.post('/outlookAccount/oauth/start', async c => c.json(result.ok(await outlookAccountService.startOAuth(c, userContext.getUserId(c)))));
app.get('/oauth/outlook/callback', async c => {
	let success = false;
	try {
		await outlookAccountService.finishOAuth(c, c.req.query('code'), c.req.query('state'));
		success = true;
	} catch (error) {
		console.error('Outlook OAuth callback failed', error);
	}
	const targetOrigin = JSON.stringify(new URL(c.req.url).origin);
	const result = JSON.stringify({ type: 'outlook-oauth-result', success });
	return c.html(`<!doctype html><script>window.opener?.postMessage(${result}, ${targetOrigin});window.close();</script>`);
});
app.post('/outlookAccount/import', async c => { const body = await c.req.json(); return c.json(result.ok(await outlookAccountService.importRows(c, userContext.getUserId(c), body.rows))); });
app.put('/outlookAccount/set', async c => c.json(result.ok(await outlookAccountService.setOrganization(c, userContext.getUserId(c), await c.req.json()))));
app.put('/outlookAccount/batchSetGroup', async c => { let body; try { body = await c.req.json(); } catch { body = {}; } return c.json(result.ok(await outlookAccountService.batchSetGroup(c, userContext.getUserId(c), body))); });
app.delete('/outlookAccount/batchDelete', async c => { let body; try { body = await c.req.json(); } catch { body = {}; } return c.json(result.ok(await outlookAccountService.batchDelete(c, userContext.getUserId(c), body))); });
app.delete('/outlookAccount/delete', async c => c.json(result.ok(await outlookAccountService.delete(c, userContext.getUserId(c), c.req.query('outlookAccountId')))));
