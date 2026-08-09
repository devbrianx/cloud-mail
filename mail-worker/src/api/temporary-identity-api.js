import app from '../hono/hono';
import result from '../model/result';
import temporaryIdentityService from '../service/temporary-identity-service';

app.get('/temporaryIdentity/list', async c => c.json(result.ok(await temporaryIdentityService.list(c, c.req.query()))));
app.get('/temporaryIdentity/detail/:rowkey', async c => c.json(result.ok(await temporaryIdentityService.detail(c, c.req.param('rowkey')))));
app.post('/temporaryIdentity/add', async c => c.json(result.ok(await temporaryIdentityService.add(c, await c.req.json()))));
app.post('/temporaryIdentity/import', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.import(c, body.records)));
});
app.put('/temporaryIdentity/set/:rowkey', async c => c.json(result.ok(await temporaryIdentityService.set(c, c.req.param('rowkey'), await c.req.json()))));
app.delete('/temporaryIdentity/delete', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await temporaryIdentityService.delete(c, body.rowkeys)));
});
