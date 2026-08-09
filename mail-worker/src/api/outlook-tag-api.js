import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import outlookTagService from '../service/outlook-tag-service';

app.get('/outlookTag/list', async c => c.json(result.ok(await outlookTagService.list(c, userContext.getUserId(c)))));
app.post('/outlookTag/add', async c => c.json(result.ok(await outlookTagService.add(c, userContext.getUserId(c), (await c.req.json()).name))));
app.put('/outlookTag/set', async c => { const body = await c.req.json(); return c.json(result.ok(await outlookTagService.set(c, userContext.getUserId(c), body.outlookTagId, body.name))); });
app.delete('/outlookTag/delete', async c => c.json(result.ok(await outlookTagService.delete(c, userContext.getUserId(c), c.req.query('outlookTagId')))));
