import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import temporaryIdentityService from '../service/temporary-identity-service';

app.get('/temporaryIdentity/countries', async c => c.json(result.ok(await temporaryIdentityService.countries(c, userContext.getUserId(c)))));
app.post('/temporaryIdentity/country/add', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.addCountry(c, userContext.getUserId(c), body.country)));
});
app.put('/temporaryIdentity/country/set/:country', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.renameCountry(c, userContext.getUserId(c), c.req.param('country'), body.country)));
});
app.delete('/temporaryIdentity/country/delete/:country', async c => c.json(result.ok(await temporaryIdentityService.deleteCountry(c, userContext.getUserId(c), c.req.param('country')))));
app.get('/temporaryIdentity/list', async c => c.json(result.ok(await temporaryIdentityService.list(c, userContext.getUserId(c), c.req.query()))));
app.get('/temporaryIdentity/detail/:rowkey', async c => c.json(result.ok(await temporaryIdentityService.detail(c, userContext.getUserId(c), c.req.param('rowkey')))));
app.post('/temporaryIdentity/add', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.add(c, userContext.getUserId(c), body.country, body.data)));
});
app.put('/temporaryIdentity/set/:rowkey', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.set(c, userContext.getUserId(c), c.req.param('rowkey'), body.data)));
});
app.delete('/temporaryIdentity/delete', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.delete(c, userContext.getUserId(c), body.rowkeys)));
});
