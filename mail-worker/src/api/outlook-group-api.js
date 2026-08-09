import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import outlookGroupService from '../service/outlook-group-service';

app.get('/outlookGroup/list', async c => c.json(result.ok(await outlookGroupService.list(c, userContext.getUserId(c)))));
app.post('/outlookGroup/add', async c => c.json(result.ok(await outlookGroupService.add(c, userContext.getUserId(c), (await c.req.json()).name))));
app.put('/outlookGroup/set', async c => { const body = await c.req.json(); return c.json(result.ok(await outlookGroupService.set(c, userContext.getUserId(c), body.outlookGroupId, body.name))); });
app.delete('/outlookGroup/delete', async c => c.json(result.ok(await outlookGroupService.delete(c, userContext.getUserId(c), c.req.query('outlookGroupId')))));
