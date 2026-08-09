import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import outlookAccountService from '../service/outlook-account-service';

app.get('/outlookAccount/list', async c => c.json(result.ok(await outlookAccountService.list(c, userContext.getUserId(c), c.req.query()))));
app.post('/outlookAccount/oauth/start', async c => c.json(result.ok(await outlookAccountService.startOAuth(c, userContext.getUserId(c), await c.req.json()))));
app.get('/oauth/outlook/callback', async c => {
	try {
		await outlookAccountService.finishOAuth(c, c.req.query('code'), c.req.query('state'));
		return c.redirect('/outlook-accounts?oauth=success');
	} catch (error) {
		console.error('Outlook OAuth callback failed', error);
		return c.redirect('/outlook-accounts?oauth=error');
	}
});
app.post('/outlookAccount/import', async c => c.json(result.ok(await outlookAccountService.importRows(c, userContext.getUserId(c), (await c.req.json()).rows))));
app.put('/outlookAccount/set', async c => c.json(result.ok(await outlookAccountService.setOrganization(c, userContext.getUserId(c), await c.req.json()))));
app.delete('/outlookAccount/delete', async c => c.json(result.ok(await outlookAccountService.delete(c, userContext.getUserId(c), c.req.query('outlookAccountId')))));
