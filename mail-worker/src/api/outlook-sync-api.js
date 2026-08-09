import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import outlookSyncService from '../service/outlook-sync-service';

app.post('/outlookSync/run', async c => c.json(result.ok(await outlookSyncService.run(c, userContext.getUserId(c), await c.req.json()))));
app.get('/outlookSync/status', async c => c.json(result.ok(await outlookSyncService.status(c, userContext.getUserId(c), c.req.query('outlookAccountId')))));
